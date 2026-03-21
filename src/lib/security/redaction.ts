/**
 * Security Redaction Module - Centralized PII/secret redaction
 * 
 * CRITICAL: All API responses and UI data MUST pass through these functions
 * unless the caller is a verified admin with explicit need-to-know.
 * 
 * This module enforces redaction-by-default to prevent accidental data leaks.
 */

import {
  PII_FIELDS,
  SECRET_FIELDS,
  TRADE_SECRET_FIELDS,
  SENSITIVE_PATTERNS,
  type ViewerRole,
} from './constants';

// Redaction placeholder values
const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '***@***.***';
const REDACTED_PHONE = '***-***-****';
const REDACTED_ID = '***-****';

/**
 * Check if a field name matches any sensitive field pattern
 */
function isSensitiveField(fieldName: string, sensitiveList: readonly string[]): boolean {
  const normalized = fieldName.toLowerCase().replace(/[-_]/g, '');
  return sensitiveList.some(sensitive => {
    const normalizedSensitive = sensitive.toLowerCase().replace(/[-_]/g, '');
    return normalized.includes(normalizedSensitive) || normalizedSensitive.includes(normalized);
  });
}

/**
 * Redact a single value based on its type and field name
 */
function redactValue(value: unknown, fieldName: string): unknown {
  if (value === null || value === undefined) return value;

  const fieldLower = fieldName.toLowerCase();

  // Always redact secret fields completely
  if (isSensitiveField(fieldName, SECRET_FIELDS)) {
    return REDACTED;
  }

  // Redact PII fields with appropriate placeholders
  if (isSensitiveField(fieldName, PII_FIELDS)) {
    if (fieldLower.includes('email')) return REDACTED_EMAIL;
    if (fieldLower.includes('phone') || fieldLower.includes('mobile')) return REDACTED_PHONE;
    if (fieldLower.includes('id') || fieldLower.includes('number')) return REDACTED_ID;
    return REDACTED;
  }

  // If it's a string, scrub any embedded sensitive patterns
  if (typeof value === 'string') {
    return scrubSensitivePatterns(value);
  }

  return value;
}

/**
 * Scrub sensitive patterns from a string (emails, phone numbers, API keys)
 */
export function scrubSensitivePatterns(text: string): string {
  if (!text || typeof text !== 'string') return text;

  let result = text;
  result = result.replace(SENSITIVE_PATTERNS.email, REDACTED_EMAIL);
  result = result.replace(SENSITIVE_PATTERNS.phone, REDACTED_PHONE);
  result = result.replace(SENSITIVE_PATTERNS.apiKey, '[API_KEY_REDACTED]');
  result = result.replace(SENSITIVE_PATTERNS.bearerToken, 'Bearer [TOKEN_REDACTED]');
  result = result.replace(SENSITIVE_PATTERNS.authHeader, 'authorization: [REDACTED]');
  
  return result;
}

/**
 * Deep redact an object, removing/masking all sensitive fields
 */
export function deepRedact<T>(
  obj: T,
  options: {
    allowPII?: boolean;
    allowTradeSecrets?: boolean;
    allowSecrets?: boolean; // Should almost NEVER be true
  } = {}
): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') {
    if (typeof obj === 'string') {
      return scrubSensitivePatterns(obj) as T;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => deepRedact(item, options)) as T;
  }

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // NEVER allow secret fields regardless of options
    if (isSensitiveField(key, SECRET_FIELDS) && !options.allowSecrets) {
      result[key] = REDACTED;
      continue;
    }

    // Redact PII unless explicitly allowed
    if (isSensitiveField(key, PII_FIELDS) && !options.allowPII) {
      result[key] = redactValue(value, key);
      continue;
    }

    // Redact trade secrets unless explicitly allowed
    if (isSensitiveField(key, TRADE_SECRET_FIELDS) && !options.allowTradeSecrets) {
      result[key] = REDACTED;
      continue;
    }

    // Recursively redact nested objects
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

/**
 * Redact user profile for non-admin display
 */
export function redactUser(
  user: Record<string, unknown>,
  viewerRole: ViewerRole = 'client'
): Record<string, unknown> {
  if (viewerRole === 'admin') {
    // Admins can see PII but NEVER secrets
    return deepRedact(user, { allowPII: true, allowTradeSecrets: true });
  }

  // Non-admins get full redaction
  return deepRedact(user);
}

/**
 * Redact organization for non-admin display
 */
export function redactOrg(
  org: Record<string, unknown>,
  viewerRole: ViewerRole = 'client'
): Record<string, unknown> {
  if (viewerRole === 'admin') {
    return deepRedact(org, { allowPII: true, allowTradeSecrets: true });
  }


  return redacted;
}

/**
 * Redact match data for display based on viewer role
 */
export function redactMatch(
  match: Record<string, unknown>,
  viewerRole: ViewerRole = 'client',
  viewerOrgId?: string
): Record<string, unknown> {
  // Admin: full access except raw secrets
  if (viewerRole === 'admin' || viewerRole === 'auditor') {
    return deepRedact(match, { allowPII: true, allowTradeSecrets: true });
  }

  // Client: can see their own data, counterparty is partially redacted
  const isOwnMatch = viewerOrgId && match.org_id === viewerOrgId;
  
  if (isOwnMatch) {
    // Own org can see trade details but counterparty contact is redacted
    return deepRedact(match, { allowTradeSecrets: true });
  }

  // Not own match: full redaction
  return deepRedact(match);
}

/**
 * Redact evidence pack based on viewer role and sensitivity
 */
export function redactEvidencePack(
  evidence: Record<string, unknown>,
  viewerRole: ViewerRole = 'client',
  viewerOrgId?: string
): Record<string, unknown> {
  // Admin/auditor: full evidence access
  if (viewerRole === 'admin' || viewerRole === 'auditor') {
    return deepRedact(evidence, { allowPII: true, allowTradeSecrets: true });
  }

  // Client: redacted evidence
  const redacted = deepRedact(evidence);
  
  // Further strip internal fields that clients shouldn't see
  const clientSafe = { ...redacted };
  delete clientSafe['internal_notes'];
  delete clientSafe['internal_reasoning'];
  delete clientSafe['enriched_metadata'];
  
  return clientSafe;
}

/**
 * Format API key for safe display (prefix + last 4 chars only)
 * CRITICAL: Never return full keys or hashes
 */
export function formatApiKeyForDisplay(key: string | undefined | null): string {
  if (!key) return '****';
  
  // Only show prefix and last 4 characters
  if (key.length <= 8) return '****';
  
  const prefix = key.substring(0, 8);
  const suffix = key.substring(key.length - 4);
  
  return `${prefix}…${suffix}`;
}

/**
 * Redact API key data for frontend display
 * CRITICAL: Never expose key_hash, key_history, or full key values
 */
export function redactApiKey(
  apiKey: Record<string, unknown>
): Record<string, unknown> {
  // Explicitly allowlist only safe fields
  return {
    id: apiKey.id,
    name: apiKey.name,
    scopes: apiKey.scopes,
    status: apiKey.status,
    created_at: apiKey.created_at,
    last_used_at: apiKey.last_used_at,
    expires_at: apiKey.expires_at,
    environment: apiKey.environment,
    // Compute display prefix if available, never expose full key or hash
    key_prefix: apiKey.key_prefix || (typeof apiKey.name === 'string' ? 'sk_****' : '****'),
  };
}

/**
 * Validate that an object doesn't contain any secret fields
 * Use this to verify responses before sending to client
 */
export function assertNoSecrets(obj: unknown, context: string = 'response'): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') return;

  const checkObject = (o: Record<string, unknown>, path: string) => {
    for (const [key, value] of Object.entries(o)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (isSensitiveField(key, SECRET_FIELDS)) {
        throw new Error(
          `SECURITY VIOLATION: Secret field "${currentPath}" found in ${context}. ` +
          `This indicates a redaction failure. Do not expose this response.`
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
