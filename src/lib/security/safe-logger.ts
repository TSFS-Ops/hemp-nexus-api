/**
 * Safe Logger - Automatic scrubbing of sensitive data from logs
 * 
 * CRITICAL: Use this instead of console.log in any code that handles
 * user data, API keys, or authentication tokens.
 * 
 * This logger automatically:
 * - Scrubs email addresses
 * - Scrubs phone numbers
 * - Scrubs API keys and tokens
 * - Scrubs Authorization headers
 * - Redacts any field matching secret patterns
 */

import {
  SENSITIVE_PATTERNS,
  SENSITIVE_HEADERS,
  SECRET_FIELDS,
} from './constants';

// Redaction placeholders for logs
const LOG_REDACTIONS = {
  email: '[EMAIL]',
  phone: '[PHONE]',
  apiKey: '[API_KEY]',
  token: '[TOKEN]',
  auth: '[AUTH]',
  secret: '[SECRET]',
};

/**
 * Scrub sensitive patterns from a string value
 */
function scrubString(value: string): string {
  if (!value || typeof value !== 'string') return value;

  let result = value;
  
  // Scrub patterns
  result = result.replace(SENSITIVE_PATTERNS.email, LOG_REDACTIONS.email);
  result = result.replace(SENSITIVE_PATTERNS.phone, LOG_REDACTIONS.phone);
  result = result.replace(SENSITIVE_PATTERNS.apiKey, LOG_REDACTIONS.apiKey);
  result = result.replace(SENSITIVE_PATTERNS.bearerToken, `Bearer ${LOG_REDACTIONS.token}`);
  result = result.replace(SENSITIVE_PATTERNS.authHeader, `authorization: ${LOG_REDACTIONS.auth}`);

  return result;
}

/**
 * Check if a key name indicates a sensitive field
 */
function isSensitiveKey(key: string): boolean {
  const keyLower = key.toLowerCase();
  
  // Check against secret fields
  for (const secretField of SECRET_FIELDS) {
    if (keyLower.includes(secretField.toLowerCase())) {
      return true;
    }
  }
  
  // Check against sensitive headers
  for (const header of SENSITIVE_HEADERS) {
    if (keyLower.includes(header.toLowerCase())) {
      return true;
    }
  }
  
  return false;
}

/**
 * Deep scrub an object, removing/masking all sensitive values
 */
function scrubObject(obj: unknown, depth: number = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) return '[MAX_DEPTH]';
  
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === 'string') {
    return scrubString(obj);
  }
  
  if (typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => scrubObject(item, depth + 1));
  }
  
  // Handle Error objects specially
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: scrubString(obj.message),
      stack: obj.stack ? scrubString(obj.stack) : undefined,
    };
  }
  
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    // Completely redact sensitive keys
    if (isSensitiveKey(key)) {
      result[key] = LOG_REDACTIONS.secret;
      continue;
    }
    
    result[key] = scrubObject(value, depth + 1);
  }
  
  return result;
}

/**
 * Format arguments for safe logging
 */
function formatArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (typeof arg === 'string') {
      return scrubString(arg);
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        return scrubObject(arg);
      } catch {
        return '[UNSERIALIZABLE]';
      }
    }
    return arg;
  });
}

/**
 * Safe logger that automatically scrubs sensitive data
 */
export const safeLogger = {
  /**
   * Log at info level with automatic scrubbing
   */
  info: (...args: unknown[]): void => {
    console.log('[INFO]', ...formatArgs(args));
  },

  /**
   * Log at debug level with automatic scrubbing
   */
  debug: (...args: unknown[]): void => {
    console.log('[DEBUG]', ...formatArgs(args));
  },

  /**
   * Log at warn level with automatic scrubbing
   */
  warn: (...args: unknown[]): void => {
    console.warn('[WARN]', ...formatArgs(args));
  },

  /**
   * Log at error level with automatic scrubbing
   */
  error: (...args: unknown[]): void => {
    console.error('[ERROR]', ...formatArgs(args));
  },

  /**
   * Log an HTTP request with automatic header scrubbing
   */
  request: (method: string, url: string, headers?: Record<string, string>): void => {
    const safeHeaders = headers ? scrubObject(headers) : undefined;
    // Also scrub query parameters from URL
    const safeUrl = scrubString(url);
    console.log('[REQUEST]', method, safeUrl, safeHeaders);
  },

  /**
   * Log an HTTP response with automatic body scrubbing
   */
  response: (status: number, body?: unknown): void => {
    const safeBody = body ? scrubObject(body) : undefined;
    console.log('[RESPONSE]', status, safeBody);
  },

  /**
   * Log an audit event (for audit_logs table)
   * Only logs metadata, never full payloads
   */
  audit: (action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>): void => {
    const safeMetadata = metadata ? scrubObject(metadata) : {};
    console.log('[AUDIT]', {
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: safeMetadata,
      timestamp: new Date().toISOString(),
    });
  },
};

/**
 * Create a safe logger with a prefix (for edge functions)
 */
export function createSafeLogger(prefix: string) {
  return {
    info: (...args: unknown[]) => safeLogger.info(`[${prefix}]`, ...args),
    debug: (...args: unknown[]) => safeLogger.debug(`[${prefix}]`, ...args),
    warn: (...args: unknown[]) => safeLogger.warn(`[${prefix}]`, ...args),
    error: (...args: unknown[]) => safeLogger.error(`[${prefix}]`, ...args),
    request: (method: string, url: string, headers?: Record<string, string>) => 
      safeLogger.request(method, url, headers),
    response: (status: number, body?: unknown) => 
      safeLogger.response(status, body),
    audit: (action: string, entityType: string, entityId?: string, metadata?: Record<string, unknown>) =>
      safeLogger.audit(action, entityType, entityId, metadata),
  };
}

export default safeLogger;
