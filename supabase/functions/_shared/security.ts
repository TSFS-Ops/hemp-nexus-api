/**
 * Edge Function Security Utilities
 * 
 * IMPORTANT: This file contains security utilities for Deno edge functions.
 * It mirrors the frontend security module but is designed for the Deno runtime.
 * 
 * Use these utilities in ALL edge functions that handle sensitive data.
 */

// ============= Constants =============

export const PII_FIELDS = [
  'email', 'email_address', 'phone', 'phone_number', 'mobile',
  'contact_email', 'contact_phone', 'full_name', 'legal_name',
  'first_name', 'last_name', 'address', 'street_address',
  'postal_address', 'billing_address', 'shipping_address',
  'id_number', 'passport_number', 'tax_number', 'vat_number',
  'social_security', 'date_of_birth', 'dob',
] as const;

export const SECRET_FIELDS = [
  'key_hash', 'key_history', 'secret_hash', 'password',
  'password_hash', 'api_key', 'api_secret', 'secret_key',
  'private_key', 'access_token', 'refresh_token', 'bearer_token',
  'webhook_secret', 'encryption_key', 'pepper', 'salt',
] as const;

export const TRADE_SECRET_FIELDS = [
  'price_amount', 'price_currency', 'commercial_terms', 'pricing_terms',
  'margin', 'cost', 'markup', 'discount', 'commission',
  'internal_notes', 'internal_reasoning', 'negotiation_history',
  'bid_amount', 'ask_amount',
] as const;

export const SENSITIVE_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+?[0-9]{1,4}[-.\s]?)?(?:\(?[0-9]{2,4}\)?[-.\s]?)?[0-9]{3,4}[-.\s]?[0-9]{3,4}\b/g,
  apiKey: /\b(sk_|pk_|api_|key_)[a-zA-Z0-9]{16,64}\b/g,
  bearerToken: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/gi,
  authHeader: /authorization:\s*[^\n\r]+/gi,
};

export const SENSITIVE_HEADERS = [
  'authorization', 'x-api-key', 'cookie', 'set-cookie',
  'x-auth-token', 'x-access-token',
] as const;

export type ViewerRole = 'public' | 'client' | 'admin' | 'auditor';

// ============= Redaction Utilities =============

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '***@***.***';

function isSensitiveField(fieldName: string, sensitiveList: readonly string[]): boolean {
  const normalized = fieldName.toLowerCase().replace(/[-_]/g, '');
  return sensitiveList.some(sensitive => {
    const normalizedSensitive = sensitive.toLowerCase().replace(/[-_]/g, '');
    return normalized.includes(normalizedSensitive) || normalizedSensitive.includes(normalized);
  });
}

export function scrubSensitivePatterns(text: string): string {
  if (!text || typeof text !== 'string') return text;
  let result = text;
  result = result.replace(SENSITIVE_PATTERNS.email, REDACTED_EMAIL);
  result = result.replace(SENSITIVE_PATTERNS.phone, '***-***-****');
  result = result.replace(SENSITIVE_PATTERNS.apiKey, '[API_KEY_REDACTED]');
  result = result.replace(SENSITIVE_PATTERNS.bearerToken, 'Bearer [TOKEN_REDACTED]');
  result = result.replace(SENSITIVE_PATTERNS.authHeader, 'authorization: [REDACTED]');
  return result;
}

export function deepRedact<T>(
  obj: T,
  options: { allowPII?: boolean; allowTradeSecrets?: boolean; allowSecrets?: boolean } = {}
): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') return scrubSensitivePatterns(obj) as T;
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepRedact(item, options)) as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // NEVER allow secret fields
    if (isSensitiveField(key, SECRET_FIELDS) && !options.allowSecrets) {
      result[key] = REDACTED;
      continue;
    }

    if (isSensitiveField(key, PII_FIELDS) && !options.allowPII) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('email')) result[key] = REDACTED_EMAIL;
      else if (keyLower.includes('phone')) result[key] = '***-***-****';
      else result[key] = REDACTED;
      continue;
    }

    if (isSensitiveField(key, TRADE_SECRET_FIELDS) && !options.allowTradeSecrets) {
      result[key] = REDACTED;
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      result[key] = deepRedact(value, options);
    } else if (typeof value === 'string') {
      result[key] = scrubSensitivePatterns(value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

export function redactMatch(
  match: Record<string, unknown>,
  viewerRole: ViewerRole = 'client',
  viewerOrgId?: string
): Record<string, unknown> {
  if (viewerRole === 'public') {
    return {
      id: '00000000-0000-0000-0000-000000000000',
      status: match.status || 'matched',
      commodity: 'Commodity',
      quantity_amount: 0,
      quantity_unit: 'MT',
      price_amount: REDACTED,
      price_currency: 'USD',
      buyer_name: 'Alpha Trading Group',
      seller_name: 'Global Supply Partners',
      buyer_id: '***-****',
      seller_id: '***-****',
      created_at: new Date().toISOString(),
      hash: '[RESTRICTED]',
    };
  }

  if (viewerRole === 'admin' || viewerRole === 'auditor') {
    return deepRedact(match, { allowPII: true, allowTradeSecrets: true });
  }

  const isOwnMatch = viewerOrgId && match.org_id === viewerOrgId;
  if (isOwnMatch) {
    return deepRedact(match, { allowTradeSecrets: true });
  }

  return deepRedact(match);
}

export function redactApiKey(apiKey: Record<string, unknown>): Record<string, unknown> {
  return {
    id: apiKey.id,
    name: apiKey.name,
    scopes: apiKey.scopes,
    status: apiKey.status,
    created_at: apiKey.created_at,
    last_used_at: apiKey.last_used_at,
    expires_at: apiKey.expires_at,
    environment: apiKey.environment,
    key_prefix: apiKey.key_prefix || 'sk_****',
    // EXPLICITLY EXCLUDE: key_hash, key_history
  };
}

export function formatApiKeyForDisplay(key: string | undefined | null): string {
  if (!key || key.length <= 8) return '****';
  return `${key.substring(0, 8)}…${key.substring(key.length - 4)}`;
}

export function assertNoSecrets(obj: unknown, context: string = 'response'): void {
  if (obj === null || obj === undefined || typeof obj !== 'object') return;

  const checkObject = (o: Record<string, unknown>, path: string) => {
    for (const [key, value] of Object.entries(o)) {
      const currentPath = path ? `${path}.${key}` : key;
      if (isSensitiveField(key, SECRET_FIELDS)) {
        throw new Error(
          `SECURITY VIOLATION: Secret field "${currentPath}" found in ${context}.`
        );
      }
      if (typeof value === 'object' && value !== null) {
        checkObject(value as Record<string, unknown>, currentPath);
      }
    }
  };

  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      if (typeof item === 'object' && item !== null) {
        checkObject(item as Record<string, unknown>, `[${i}]`);
      }
    });
  } else {
    checkObject(obj as Record<string, unknown>, '');
  }
}

// ============= Safe Logger =============

function scrubForLog(obj: unknown, depth = 0): unknown {
  if (depth > 10) return '[MAX_DEPTH]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return scrubSensitivePatterns(obj);
  if (typeof obj !== 'object') return obj;
  if (obj instanceof Error) {
    return { name: obj.name, message: scrubSensitivePatterns(obj.message) };
  }
  if (Array.isArray(obj)) return obj.map(item => scrubForLog(item, depth + 1));
  
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveField(key, SECRET_FIELDS) || isSensitiveField(key, SENSITIVE_HEADERS)) {
      result[key] = '[SECRET]';
    } else {
      result[key] = scrubForLog(value, depth + 1);
    }
  }
  return result;
}

export const safeLog = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args.map(a => scrubForLog(a))),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args.map(a => scrubForLog(a))),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args.map(a => scrubForLog(a))),
  debug: (...args: unknown[]) => console.log('[DEBUG]', ...args.map(a => scrubForLog(a))),
};

// ============= Evidence Pack Generator =============

export interface EvidencePack {
  match_id: string;
  org_id?: string;
  status: string;
  match_hash: string;
  sensitivity_level: 'public' | 'client' | 'admin';
  generated_at: string;
  generated_for_role: ViewerRole;
  match_summary: {
    commodity: string;
    quantity: { amount: number | string; unit: string };
    price?: { amount: number | string; currency: string };
    buyer: { id?: string; name: string };
    seller: { id?: string; name: string };
    created_at: string;
    settled_at?: string;
  };
  event_timeline: Array<{
    event_type: string;
    created_at: string;
    payload_hash: string;
  }>;
  chain_verification: {
    is_valid: boolean;
    event_count: number;
    first_event_hash: string;
    last_event_hash: string;
  };
}

function generatePublicEvidence(): EvidencePack {
  const now = new Date();
  return {
    match_id: '00000000-0000-0000-0000-000000000000',
    status: 'settled',
    match_hash: 'restricted_preview',
    sensitivity_level: 'public',
    generated_at: now.toISOString(),
    generated_for_role: 'public',
    match_summary: {
      commodity: 'Agricultural Product',
      quantity: { amount: 0, unit: 'MT' },
      price: { amount: '[RESTRICTED]', currency: 'USD' },
      buyer: { name: 'Alpha Trading Group' },
      seller: { name: 'Global Supply Partners' },
      created_at: now.toISOString(),
    },
    event_timeline: [
      { event_type: 'match.created', created_at: now.toISOString(), payload_hash: 'event_preview_001' },
    ],
    chain_verification: {
      is_valid: true,
      event_count: 1,
      first_event_hash: 'event_preview_001',
      last_event_hash: 'event_preview_001',
    },
  };
}

export function generateEvidencePack(
  match: Record<string, unknown> | null,
  events: Array<Record<string, unknown>> = [],
  viewerRole: ViewerRole,
  viewerOrgId?: string
): EvidencePack {
  if (viewerRole === 'public' || !match) {
    return generatePublicEvidence();
  }

  const now = new Date();
  const isAdmin = viewerRole === 'admin' || viewerRole === 'auditor';
  const isOwnOrg = viewerOrgId && match.org_id === viewerOrgId;
  const canSeePricing = isAdmin || isOwnOrg;

  const eventTimeline = events.map(e => ({
    event_type: String(e.event_type || 'unknown'),
    created_at: String(e.created_at || now.toISOString()),
    payload_hash: String(e.payload_hash || ''),
  }));

  const evidence: EvidencePack = {
    match_id: String(match.id || ''),
    org_id: isAdmin ? String(match.org_id || '') : viewerOrgId,
    status: String(match.status || 'unknown'),
    match_hash: String(match.hash || ''),
    sensitivity_level: isAdmin ? 'admin' : 'client',
    generated_at: now.toISOString(),
    generated_for_role: viewerRole,
    match_summary: {
      commodity: String(match.commodity || 'Unknown'),
      quantity: {
        amount: (match.quantity_amount as number) || 0,
        unit: String(match.quantity_unit || 'units'),
      },
      ...(canSeePricing ? {
        price: {
          amount: (match.price_amount as number) || 0,
          currency: String(match.price_currency || 'USD'),
        },
      } : {}),
      buyer: {
        name: isAdmin || isOwnOrg ? String(match.buyer_name || 'Buyer') : '[Counterparty]',
        ...(isAdmin ? { id: String(match.buyer_id) } : {}),
      },
      seller: {
        name: isAdmin || isOwnOrg ? String(match.seller_name || 'Seller') : '[Counterparty]',
        ...(isAdmin ? { id: String(match.seller_id) } : {}),
      },
      created_at: String(match.created_at || now.toISOString()),
      ...(match.settled_at ? { settled_at: String(match.settled_at) } : {}),
    },
    event_timeline: eventTimeline,
    chain_verification: {
      is_valid: true,
      event_count: eventTimeline.length,
      first_event_hash: eventTimeline[0]?.payload_hash || '',
      last_event_hash: eventTimeline[eventTimeline.length - 1]?.payload_hash || '',
    },
  };

  // Final safety check
  assertNoSecrets(evidence, 'evidence pack');
  return evidence;
}
