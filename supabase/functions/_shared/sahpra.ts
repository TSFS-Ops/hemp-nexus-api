// Shared SAHPRA verification logic
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

export interface SahpraVerificationResult {
  verified: boolean;
  reason: string;
  match?: any;
  checkedAt: string;
  licenceNo?: string;
}

// Levenshtein distance for fuzzy matching
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[b.length][a.length];
}

function similarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  const longerLength = longer.length;
  
  if (longerLength === 0) {
    return 1.0;
  }
  
  return (longerLength - levenshteinDistance(longer, shorter)) / longerLength;
}

export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function updateSahpraCache(supabase: any): Promise<void> {
  const csvUrl = Deno.env.get('CONNECTOR_SAHPRA_URL');
  
  if (!csvUrl) {
    throw new Error('CONNECTOR_SAHPRA_URL not configured');
  }
  
  console.log('[SAHPRA] Downloading CSV from source');
  
  const response = await fetch(csvUrl);
  
  if (!response.ok) {
    throw new Error(`Failed to download CSV: ${response.status}`);
  }
  
  const csvText = await response.text();
  const lines = csvText.split('\n').filter(line => line.trim());
  
  if (lines.length < 2) {
    throw new Error('CSV file is empty or invalid');
  }
  
  // Parse header
  const header = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
  console.log('[SAHPRA] CSV headers:', header);
  
  // Clear existing cache
  await supabase.from('sahpra_licenses').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  // Parse and insert rows
  const licenses = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
    
    if (values.length < header.length) continue;
    
    const row: any = {};
    header.forEach((h, idx) => {
      row[h] = values[idx];
    });
    
    // Normalize to expected schema
    const companyName = row['Company Name'] || row['company_name'] || '';
    const license = {
      company_name: companyName,
      company_name_norm: normalizeCompanyName(companyName),
      licence_no: row['Licence No'] || row['licence_no'] || '',
      licence_type: row['Licence Type'] || row['licence_type'] || null,
      responsible_pharmacist: row['Responsible Pharmacist'] || row['responsible_pharmacist'] || null,
      province: row['Province'] || row['province'] || null,
      date_issued: row['Date Issued'] || row['date_issued'] || null,
      expiry_date: row['Expiry Date'] || row['expiry_date'] || null,
    };
    
    if (license.company_name && license.licence_no && license.expiry_date) {
      licenses.push(license);
    }
  }
  
  console.log(`[SAHPRA] Inserting ${licenses.length} licenses into cache`);
  
  if (licenses.length > 0) {
    const { error } = await supabase.from('sahpra_licenses').insert(licenses);
    
    if (error) {
      console.error('[SAHPRA] Error inserting licenses:', error);
      throw error;
    }
  }
  
  console.log('[SAHPRA] Cache updated successfully');
}

export async function verifySahpra(
  supabase: any,
  companyName: string,
  licenceNo?: string
): Promise<SahpraVerificationResult> {
  const normalizedInput = normalizeCompanyName(companyName);
  const checkedAt = new Date().toISOString();
  
  console.log(`[SAHPRA] Verifying: ${companyName}, Licence: ${licenceNo || 'N/A'}`);
  
  // Fetch all licenses (with expiry check)
  const today = new Date().toISOString().split('T')[0];
  const { data: licenses, error } = await supabase
    .from('sahpra_licenses')
    .select('*')
    .gt('expiry_date', today);
  
  if (error) {
    console.error('[SAHPRA] Error fetching licenses:', error);
    return { verified: false, match: null, reason: 'Database error', checkedAt };
  }
  
  if (!licenses || licenses.length === 0) {
    return { verified: false, match: null, reason: 'No valid licenses in database', checkedAt };
  }
  
  // Find best match
  let bestMatch: any = null;
  let bestScore = 0;
  
  for (const license of licenses) {
    const normalizedLicense = license.company_name_norm || normalizeCompanyName(license.company_name);
    const score = similarity(normalizedInput, normalizedLicense);
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = license;
    }
  }
  
  // Check if match meets threshold
  if (bestScore < 0.9) {
    return { 
      verified: false, 
      match: null, 
      reason: `No matching company found (best match: ${(bestScore * 100).toFixed(1)}% similarity)`,
      checkedAt
    };
  }
  
  // If licence number provided, require exact match
  if (licenceNo && bestMatch.licence_no !== licenceNo) {
    return {
      verified: false,
      match: bestMatch,
      reason: `Company matched but licence number mismatch (expected: ${licenceNo}, found: ${bestMatch.licence_no})`,
      checkedAt
    };
  }
  
  return {
    verified: true,
    match: bestMatch,
    reason: 'Valid SAHPRA licence found',
    licenceNo: bestMatch.licence_no,
    checkedAt
  };
}

export async function verifySahpraForOrg(orgId: string, supabase: any): Promise<SahpraVerificationResult> {
  try {
    console.log(`[${orgId}] Running SAHPRA verification`);
    
    // Get organization details
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('name, sahpra_verified, sahpra_verified_at, sahpra_licence_no')
      .eq('id', orgId)
      .single();
    
    if (orgError || !org) {
      console.error(`[${orgId}] Failed to fetch organization`);
      return { 
        verified: false, 
        checkedAt: new Date().toISOString(), 
        reason: 'Organization not found' 
      };
    }
    
    // Check if already verified recently (within 24 hours) - return cached result
    if (org.sahpra_verified && org.sahpra_verified_at) {
      const verifiedAt = new Date(org.sahpra_verified_at).getTime();
      const now = Date.now();
      const hoursSinceVerification = (now - verifiedAt) / (1000 * 60 * 60);
      
      if (hoursSinceVerification < 24) {
        console.log(`[${orgId}] Using cached verification (${hoursSinceVerification.toFixed(1)}h old)`);
        return {
          verified: org.sahpra_verified,
          checkedAt: org.sahpra_verified_at,
          licenceNo: org.sahpra_licence_no || undefined,
          reason: 'Valid SAHPRA licence found (cached)'
        };
      }
    }
    
    // Run fresh verification
    const result = await verifySahpra(supabase, org.name);
    console.log(`[${orgId}] SAHPRA verification result:`, result.verified ? 'VERIFIED' : 'NOT VERIFIED');
    
    // Update organization with verification result
    await supabase
      .from('organizations')
      .update({
        sahpra_verified: result.verified,
        sahpra_verification_data: result.match,
        sahpra_verified_at: result.checkedAt,
        sahpra_licence_no: result.match?.licence_no || null,
      })
      .eq('id', orgId);
    
    return result;
    
  } catch (error) {
    console.error(`[${orgId}] SAHPRA verification error:`, error);
    return { 
      verified: false, 
      checkedAt: new Date().toISOString(), 
      reason: 'Verification failed' 
    };
  }
}
