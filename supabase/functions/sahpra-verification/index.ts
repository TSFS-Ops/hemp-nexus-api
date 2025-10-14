import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function updateSahpraCache(supabase: any): Promise<void> {
  const csvUrl = Deno.env.get('CONNECTOR_SAHPRA_URL');
  
  if (!csvUrl) {
    console.error('[SAHPRA] CONNECTOR_SAHPRA_URL not configured');
    return;
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
    const license = {
      company_name: row['Company Name'] || row['company_name'] || '',
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

async function verifySahpra(
  supabase: any,
  companyName: string,
  licenceNo?: string
): Promise<{ verified: boolean; match: any | null; reason: string }> {
  const normalizedInput = normalizeCompanyName(companyName);
  
  console.log(`[SAHPRA] Verifying: ${companyName}, Licence: ${licenceNo || 'N/A'}`);
  
  // Fetch all licenses (with expiry check)
  const today = new Date().toISOString().split('T')[0];
  const { data: licenses, error } = await supabase
    .from('sahpra_licenses')
    .select('*')
    .gt('expiry_date', today);
  
  if (error) {
    console.error('[SAHPRA] Error fetching licenses:', error);
    return { verified: false, match: null, reason: 'Database error' };
  }
  
  if (!licenses || licenses.length === 0) {
    return { verified: false, match: null, reason: 'No valid licenses in database' };
  }
  
  // Find best match
  let bestMatch: any = null;
  let bestScore = 0;
  
  for (const license of licenses) {
    const normalizedLicense = normalizeCompanyName(license.company_name);
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
      reason: `No matching company found (best match: ${(bestScore * 100).toFixed(1)}% similarity)` 
    };
  }
  
  // If licence number provided, require exact match
  if (licenceNo && bestMatch.licence_no !== licenceNo) {
    return {
      verified: false,
      match: bestMatch,
      reason: `Company matched but licence number mismatch (expected: ${licenceNo}, found: ${bestMatch.licence_no})`
    };
  }
  
  return {
    verified: true,
    match: bestMatch,
    reason: 'Valid SAHPRA licence found'
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders('*') });
  }
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    const url = new URL(req.url);
    const path = url.pathname.split('/').filter(Boolean);
    
    // GET /sahpra-verification/refresh - Refresh CSV cache
    if (req.method === 'GET' && path[path.length - 1] === 'refresh') {
      await updateSahpraCache(supabase);
      
      return new Response(
        JSON.stringify({ success: true, message: 'Cache refreshed' }),
        { headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
      );
    }
    
    // POST /sahpra-verification/verify - Verify company
    if (req.method === 'POST' && path[path.length - 1] === 'verify') {
      const { companyName, licenceNo } = await req.json();
      
      if (!companyName) {
        return new Response(
          JSON.stringify({ error: 'companyName is required' }),
          { status: 400, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
        );
      }
      
      const result = await verifySahpra(supabase, companyName, licenceNo);
      
      return new Response(
        JSON.stringify(result),
        { headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: 'Not found' }),
      { status: 404, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('[SAHPRA] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders('*'), 'Content-Type': 'application/json' } }
    );
  }
});
