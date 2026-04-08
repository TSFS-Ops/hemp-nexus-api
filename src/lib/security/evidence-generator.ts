/**
 * Evidence Pack Generator - Role-based evidence views
 * 
 * CRITICAL: This is the ONLY way to generate evidence packs.
 * Never return raw match rows or evidence data directly.
 * 
 * Evidence Views:
 * - client: Only what the client org is allowed to see
 * - admin/auditor: Full detail for compliance purposes
 */

import { type ViewerRole, type SensitivityLevel } from './constants';
import { redactMatch, redactEvidencePack, deepRedact, assertNoSecrets } from './redaction';

/**
 * Evidence pack structure returned to callers
 */
export interface EvidencePack {
  match_id: string;
  org_id?: string;
  status: string;
  match_hash: string;
  sensitivity_level: SensitivityLevel;
  generated_at: string;
  generated_for_role: ViewerRole;
  
  // Match summary (redacted based on role)
  match_summary: {
    commodity: string;
    quantity: { amount: number | string; unit: string };
    price?: { amount: number | string; currency: string };
    buyer: { id?: string; name: string };
    seller: { id?: string; name: string };
    created_at: string;
    settled_at?: string;
  };
  
  // Event timeline (hashes only, never raw data)
  event_timeline: Array<{
    event_type: string;
    created_at: string;
    payload_hash: string;
  }>;
  
  // Documents (metadata only, never content)
  documents?: Array<{
    id: string;
    doc_type: string;
    filename: string;
    sha256_hash: string;
    status: string;
    uploaded_at: string;
  }>;
  
  // Chain verification
  chain_verification: {
    is_valid: boolean;
    event_count: number;
    first_event_hash: string;
    last_event_hash: string;
  };
}

/**
 * Empty evidence pack returned when no match data is available
 */
function generateEmptyEvidence(): EvidencePack {
  const now = new Date();
  return {
    match_id: '',
    status: 'unavailable',
    match_hash: '',
    sensitivity_level: 'public',
    generated_at: now.toISOString(),
    generated_for_role: 'client',
    match_summary: {
      commodity: 'N/A',
      quantity: { amount: 0, unit: 'N/A' },
      buyer: { name: 'N/A' },
      seller: { name: 'N/A' },
      created_at: now.toISOString(),
    },
    event_timeline: [],
    documents: [],
    chain_verification: {
      is_valid: false,
      event_count: 0,
      first_event_hash: '',
      last_event_hash: '',
    },
  };
}

/**
 * Generate client evidence - redacted for the requesting org
 */
function generateClientEvidence(
  match: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
  documents: Array<Record<string, unknown>> | undefined,
  viewerOrgId: string
): EvidencePack {
  const now = new Date();
  const isOwnMatch = match.org_id === viewerOrgId;
  
  // Determine what the client can see
  const canSeePricing = isOwnMatch;
  const canSeeCounterpartyDetails = isOwnMatch;
  
  const matchSummary = {
    commodity: String(match.commodity || 'Unknown'),
    quantity: {
      amount: match.quantity_amount as number || 0,
      unit: String(match.quantity_unit || 'units'),
    },
    ...(canSeePricing ? {
      price: {
        amount: match.price_amount as number || 0,
        currency: String(match.price_currency || 'USD'),
      },
    } : {}),
    buyer: {
      name: canSeeCounterpartyDetails ? String(match.buyer_name || 'Buyer') : '[Counterparty]',
      ...(canSeeCounterpartyDetails ? { id: String(match.buyer_id) } : {}),
    },
    seller: {
      name: canSeeCounterpartyDetails ? String(match.seller_name || 'Seller') : '[Counterparty]',
      ...(canSeeCounterpartyDetails ? { id: String(match.seller_id) } : {}),
    },
    created_at: String(match.created_at || now.toISOString()),
    ...(match.settled_at ? { settled_at: String(match.settled_at) } : {}),
  };
  
  // Events - only hashes, never raw data
  const eventTimeline = (events || []).map(event => ({
    event_type: String(event.event_type || 'unknown'),
    created_at: String(event.created_at || now.toISOString()),
    payload_hash: String(event.payload_hash || ''),
  }));
  
  // Documents - metadata only, never content
  const docList = (documents || []).map(doc => ({
    id: String(doc.id || ''),
    doc_type: String(doc.doc_type || 'document'),
    filename: String(doc.filename || 'file'),
    sha256_hash: String(doc.sha256_hash || ''),
    status: String(doc.status || 'uploaded'),
    uploaded_at: String(doc.created_at || now.toISOString()),
  }));
  
  return {
    match_id: String(match.id || ''),
    org_id: viewerOrgId,
    status: String(match.status || 'unknown'),
    match_hash: String(match.hash || ''),
    sensitivity_level: 'client',
    generated_at: now.toISOString(),
    generated_for_role: 'client',
    match_summary: matchSummary,
    event_timeline: eventTimeline,
    documents: docList.length > 0 ? docList : undefined,
    chain_verification: {
      is_valid: true, // Should be computed from actual chain validation
      event_count: eventTimeline.length,
      first_event_hash: eventTimeline[0]?.payload_hash || '',
      last_event_hash: eventTimeline[eventTimeline.length - 1]?.payload_hash || '',
    },
  };
}

/**
 * Generate admin evidence - full access for compliance
 */
function generateAdminEvidence(
  match: Record<string, unknown>,
  events: Array<Record<string, unknown>>,
  documents: Array<Record<string, unknown>> | undefined
): EvidencePack {
  const now = new Date();
  
  // Admins can see everything except raw secrets
  const redactedMatch = deepRedact(match, { allowPII: true, allowTradeSecrets: true });
  
  const matchSummary = {
    commodity: String(redactedMatch.commodity || 'Unknown'),
    quantity: {
      amount: redactedMatch.quantity_amount as number || 0,
      unit: String(redactedMatch.quantity_unit || 'units'),
    },
    price: {
      amount: redactedMatch.price_amount as number || 0,
      currency: String(redactedMatch.price_currency || 'USD'),
    },
    buyer: {
      id: String(redactedMatch.buyer_id || ''),
      name: String(redactedMatch.buyer_name || 'Unknown'),
    },
    seller: {
      id: String(redactedMatch.seller_id || ''),
      name: String(redactedMatch.seller_name || 'Unknown'),
    },
    created_at: String(redactedMatch.created_at || now.toISOString()),
    ...(redactedMatch.settled_at ? { settled_at: String(redactedMatch.settled_at) } : {}),
  };
  
  const eventTimeline = (events || []).map(event => ({
    event_type: String(event.event_type || 'unknown'),
    created_at: String(event.created_at || now.toISOString()),
    payload_hash: String(event.payload_hash || ''),
  }));
  
  const docList = (documents || []).map(doc => ({
    id: String(doc.id || ''),
    doc_type: String(doc.doc_type || 'document'),
    filename: String(doc.filename || 'file'),
    sha256_hash: String(doc.sha256_hash || ''),
    status: String(doc.status || 'uploaded'),
    uploaded_at: String(doc.created_at || now.toISOString()),
  }));
  
  return {
    match_id: String(match.id || ''),
    org_id: String(match.org_id || ''),
    status: String(match.status || 'unknown'),
    match_hash: String(match.hash || ''),
    sensitivity_level: 'admin',
    generated_at: now.toISOString(),
    generated_for_role: 'admin',
    match_summary: matchSummary,
    event_timeline: eventTimeline,
    documents: docList.length > 0 ? docList : undefined,
    chain_verification: {
      is_valid: true,
      event_count: eventTimeline.length,
      first_event_hash: eventTimeline[0]?.payload_hash || '',
      last_event_hash: eventTimeline[eventTimeline.length - 1]?.payload_hash || '',
    },
  };
}

/**
 * Main evidence pack generator
 * 
 * @param match - The match data from database
 * @param events - The match events from database
 * @param documents - Optional documents attached to match
 * @param viewerRole - The role of the viewer (client/admin/auditor)
 * @param viewerOrgId - The org ID of the viewer (required for client role)
 * @returns Role-appropriate evidence pack
 */
export function generateEvidencePack(
  match: Record<string, unknown> | null,
  events: Array<Record<string, unknown>> = [],
  documents: Array<Record<string, unknown>> = [],
  viewerRole: ViewerRole,
  viewerOrgId?: string
): EvidencePack {
  // No match data available
  if (!match) {
    return generateEmptyEvidence();
  }
  
  // Admin/auditor: full access
  if (viewerRole === 'admin' || viewerRole === 'auditor') {
    const evidence = generateAdminEvidence(match, events, documents);
    assertNoSecrets(evidence, 'admin evidence pack');
    return evidence;
  }
  
  // Client: restricted view
  if (!viewerOrgId) {
    return generateEmptyEvidence();
  }
  
  const evidence = generateClientEvidence(match, events, documents, viewerOrgId);
  // Safety check: verify no secrets leaked
  assertNoSecrets(evidence, 'client evidence pack');
  return evidence;
}

/**
 * Validate that the caller has access to view a match's evidence
 */
export function canAccessEvidence(
  match: Record<string, unknown>,
  viewerRole: ViewerRole,
  viewerOrgId?: string
): boolean {
  // Admin/auditor can see all
  if (viewerRole === 'admin' || viewerRole === 'auditor') return true;
  
  // Client must be from the same org
  if (viewerRole === 'client' && viewerOrgId) {
    return match.org_id === viewerOrgId;
  }
  
  return false;
}
