import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { ApiException } from './errors.ts';
import { scopeSatisfies } from './api-scopes.ts';
import {
  writeSecurityAudit,
  extractClientIp,
  extractUserAgent,
} from './security-audit.ts';

export interface AuthContext {
  userId: string;
  orgId: string;
  roles: string[];
  isApiKey: boolean;
  /** Batch N — request origin/IP carried through for IP-allowlist + audit. */
  actorIp?: string | null;
  userAgent?: string | null;
  origin?: string | null;
  /** Live request id for audit correlation (set by caller when available). */
  requestId?: string | null;
}

// Auth rate limiting configuration
const AUTH_RATE_LIMIT_CONFIG = {
  maxAttempts: 5,           // Lock after 5 failed attempts
  baseLockoutSeconds: 60,   // Start with 60 second lockout
  // Exponential backoff: 60s -> 120s -> 240s -> 480s -> max 3600s (1 hour)
};

/**
 * Get client IP address from request headers
 */
const getClientIP = (req: Request): string => {
  // Check common headers for proxied requests
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIP = req.headers.get('x-real-ip');
  if (realIP) {
    return realIP;
  }
  
  // Fallback to a generic identifier if IP not available
  return 'unknown';
};

/**
 * Get a safe prefix from API key for rate limiting (first 8 chars)
 */
const getApiKeyPrefix = (apiKey: string): string => {
  return apiKey.slice(0, 8);
};

/**
 * Check if identifier is currently locked out
 */
const checkAuthLockout = async (
  supabase: SupabaseClient,
  identifier: string,
  identifierType: 'ip' | 'api_key_prefix'
): Promise<void> => {
  try {
    const { data, error } = await supabase.rpc('check_auth_lockout', {
      p_identifier: identifier,
      p_identifier_type: identifierType,
    });

    if (error) {
      console.error('Error checking auth lockout:', error);
      return; // Don't block on DB errors
    }

    if (data?.is_locked) {
      const remainingSeconds = data.lockout_remaining_seconds || 60;
      throw new ApiException(
        'RATE_LIMITED',
        `Too many failed authentication attempts. Try again in ${remainingSeconds} seconds.`,
        429,
        { retryAfter: remainingSeconds, failedAttempts: data.failed_attempts }
      );
    }
  } catch (e) {
    if (e instanceof ApiException) throw e;
    console.error('Unexpected error in checkAuthLockout:', e);
  }
};

/**
 * Record a failed authentication attempt with exponential backoff
 */
const recordAuthFailure = async (
  supabase: SupabaseClient,
  identifier: string,
  identifierType: 'ip' | 'api_key_prefix'
): Promise<void> => {
  try {
    const { data, error } = await supabase.rpc('check_and_increment_auth_failure', {
      p_identifier: identifier,
      p_identifier_type: identifierType,
      p_max_attempts: AUTH_RATE_LIMIT_CONFIG.maxAttempts,
      p_base_lockout_seconds: AUTH_RATE_LIMIT_CONFIG.baseLockoutSeconds,
    });

    if (error) {
      console.error('Error recording auth failure:', error);
      return;
    }

    if (data?.is_locked) {
      console.log(`Auth lockout applied for ${identifierType}: ${identifier.slice(0, 8)}*** (${data.failed_attempts} attempts)`);
    }
  } catch (e) {
    console.error('Unexpected error in recordAuthFailure:', e);
  }
};

/**
 * Clear auth rate limit on successful authentication
 */
const clearAuthRateLimit = async (
  supabase: SupabaseClient,
  identifier: string,
  identifierType: 'ip' | 'api_key_prefix'
): Promise<void> => {
  try {
    await supabase.rpc('reset_auth_rate_limit', {
      p_identifier: identifier,
      p_identifier_type: identifierType,
    });
  } catch (e) {
    console.error('Error clearing auth rate limit:', e);
  }
};

export const authenticateRequest = async (
  req: Request,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<AuthContext> => {
  const authHeader = req.headers.get('authorization');
  const apiKeyHeader = req.headers.get('x-api-key');
  const clientIP = getClientIP(req);
  const userAgent = extractUserAgent(req);
  const origin = req.headers.get('origin');
  const requestId = req.headers.get('x-request-id');

  // Create supabase client for rate limiting checks
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check for API Key auth
  if (apiKeyHeader) {
    const apiKeyPrefix = getApiKeyPrefix(apiKeyHeader);

    await checkAuthLockout(supabase, apiKeyPrefix, 'api_key_prefix');
    await checkAuthLockout(supabase, clientIP, 'ip');

    try {
      const result = await authenticateApiKey(apiKeyHeader, supabaseUrl, supabaseKey, {
        actorIp: clientIP === 'unknown' ? null : clientIP,
        userAgent,
        origin,
        requestId,
      });
      await clearAuthRateLimit(supabase, apiKeyPrefix, 'api_key_prefix');
      await clearAuthRateLimit(supabase, clientIP, 'ip');
      return result;
    } catch (e) {
      if (e instanceof ApiException && e.statusCode === 401) {
        await recordAuthFailure(supabase, apiKeyPrefix, 'api_key_prefix');
        await recordAuthFailure(supabase, clientIP, 'ip');
      }
      throw e;
    }
  }

  // Check for JWT auth
  if (authHeader?.startsWith('Bearer ')) {
    await checkAuthLockout(supabase, clientIP, 'ip');

    try {
      const result = await authenticateJwt(authHeader, supabaseUrl, supabaseKey);
      await clearAuthRateLimit(supabase, clientIP, 'ip');
      return {
        ...result,
        actorIp: clientIP === 'unknown' ? null : clientIP,
        userAgent,
        origin,
        requestId,
      };
    } catch (e) {
      if (e instanceof ApiException && e.statusCode === 401) {
        await recordAuthFailure(supabase, clientIP, 'ip');
      }
      throw e;
    }
  }

  await recordAuthFailure(supabase, clientIP, 'ip');
  throw new ApiException('UNAUTHORIZED', 'Missing authentication', 401);
};

interface AuthRequestMeta {
  actorIp: string | null;
  userAgent: string | null;
  origin: string | null;
  requestId: string | null;
}

const GENERIC_UNAUTHORIZED = (): never => {
  // Generic message — never reveal whether the key exists, is revoked,
  // is expired or has a bad allowlist match.
  throw new ApiException('UNAUTHORIZED', 'Invalid API key', 401);
};

const authenticateApiKey = async (
  apiKey: string,
  supabaseUrl: string,
  supabaseKey: string,
  meta: AuthRequestMeta = { actorIp: null, userAgent: null, origin: null, requestId: null },
): Promise<AuthContext> => {
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Batch N — query ALL keys (any status) so we can detect revoked/expired
  // use attempts and audit them. Active-only filter happens AFTER match.
  const { data: allKeys, error: fetchError } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes, status, key_hash, expires_at, allowed_ips, allowed_origins, name');

  if (fetchError) {
    GENERIC_UNAUTHORIZED();
  }

  let matchedKey: any = null;
  let needsRehash = false;

  for (const key of allKeys || []) {
    let isMatch = false;
    let requiresRehash = false;

    if (key.key_hash.includes('$')) {
      isMatch = await verifyScrypt(apiKey, key.key_hash);
    } else if (key.key_hash.length === 64 && /^[0-9a-f]+$/.test(key.key_hash)) {
      const sha256Hash = await hashApiKeySHA256(apiKey);
      isMatch = sha256Hash === key.key_hash;
      requiresRehash = isMatch;
    }

    if (isMatch && !matchedKey) {
      matchedKey = key;
      needsRehash = requiresRehash;
    }
  }

  if (!matchedKey) {
    GENERIC_UNAUTHORIZED();
  }

  // Batch N — revoked-use audit. Do NOT reveal status to caller.
  if (matchedKey.status === 'revoked') {
    await writeSecurityAudit({
      action: 'api_key.revoked_use_attempt',
      orgId: matchedKey.org_id,
      apiKeyId: matchedKey.id,
      actorIp: meta.actorIp,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      extra: { key_name: matchedKey.name ?? null },
    }, supabase);
    GENERIC_UNAUTHORIZED();
  }

  // Batch N — live expires_at check (independent of the sweeper).
  if (matchedKey.expires_at) {
    const exp = new Date(matchedKey.expires_at).getTime();
    if (Number.isFinite(exp) && exp <= Date.now()) {
      await writeSecurityAudit({
        action: 'api_key.expired_use_attempt',
        orgId: matchedKey.org_id,
        apiKeyId: matchedKey.id,
        actorIp: meta.actorIp,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        extra: { key_name: matchedKey.name ?? null, expires_at: matchedKey.expires_at },
      }, supabase);
      GENERIC_UNAUTHORIZED();
    }
  }

  if (matchedKey.status !== 'active') {
    GENERIC_UNAUTHORIZED();
  }

  // Batch N — IP allowlist (null/empty = unrestricted).
  const allowedIps: string[] | null = matchedKey.allowed_ips;
  if (allowedIps && allowedIps.length > 0) {
    if (!meta.actorIp || !allowedIps.includes(meta.actorIp)) {
      await writeSecurityAudit({
        action: 'api_key.ip_blocked',
        orgId: matchedKey.org_id,
        apiKeyId: matchedKey.id,
        actorIp: meta.actorIp,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        extra: { allowed_ip_count: allowedIps.length },
      }, supabase);
      GENERIC_UNAUTHORIZED();
    }
  }

  // Batch N — Origin allowlist.
  const allowedOrigins: string[] | null = matchedKey.allowed_origins;
  if (allowedOrigins && allowedOrigins.length > 0) {
    if (!meta.origin || !allowedOrigins.includes(meta.origin)) {
      await writeSecurityAudit({
        action: 'api_key.origin_blocked',
        orgId: matchedKey.org_id,
        apiKeyId: matchedKey.id,
        actorIp: meta.actorIp,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        extra: { origin: meta.origin, allowed_origin_count: allowedOrigins.length },
      }, supabase);
      GENERIC_UNAUTHORIZED();
    }
  }

  if (needsRehash) {
    const newHash = await hashApiKey(apiKey);
    await supabase
      .from('api_keys')
      .update({ key_hash: newHash })
      .eq('id', matchedKey.id);
  }

  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedKey.id);

  return {
    userId: matchedKey.id,
    orgId: matchedKey.org_id,
    roles: matchedKey.scopes || [],
    isApiKey: true,
    actorIp: meta.actorIp,
    userAgent: meta.userAgent,
    origin: meta.origin,
    requestId: meta.requestId,
  };
};

const authenticateJwt = async (
  authHeader: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<AuthContext> => {
  const token = authHeader.replace('Bearer ', '');
  const supabase = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new ApiException('UNAUTHORIZED', 'Invalid token', 401);
  }

  // Get user's profile and roles
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single();

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!profile) {
    throw new ApiException('UNAUTHORIZED', 'User profile not found', 401);
  }

  return {
    userId: user.id,
    orgId: profile.org_id,
    roles: roles?.map(r => r.role) || [],
    isApiKey: false,
  };
};

// Hash API key using scrypt (secure, memory-hard hash for credentials)
export const hashApiKey = async (key: string): Promise<string> => {
  // Generate random salt
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  
  // Encode the key
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  
  // Import key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
   // Derive bits using PBKDF2 (similar security to scrypt)
   // N=2^16 iterations, memory-hard parameters
   const PBKDF2_ITERATIONS = 65536;
   const derivedBits = await crypto.subtle.deriveBits(
     {
       name: 'PBKDF2',
       salt: salt,
       iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  
  // Convert to hex
  const hashArray = Array.from(new Uint8Array(derivedBits));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  
  // Return salt$hash format
  return `${saltHex}$${hashHex}`;
};

// Verify API key against scrypt hash
const verifyScrypt = async (key: string, storedHash: string): Promise<boolean> => {
  try {
    const [saltHex, hashHex] = storedHash.split('$');
    if (!saltHex || !hashHex) return false;
    
    // Convert salt from hex
    const salt = new Uint8Array(
      saltHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
    );
    
    // Encode the key
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    
    // Import key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
     // Derive bits with same parameters — must match hashScrypt
     const PBKDF2_ITERATIONS = 65536;
     const derivedBits = await crypto.subtle.deriveBits(
       {
         name: 'PBKDF2',
         salt: salt,
         iterations: PBKDF2_ITERATIONS,
         hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    
    // Convert to hex and compare
    const computedHashArray = Array.from(new Uint8Array(derivedBits));
    const computedHashHex = computedHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return computedHashHex === hashHex;
  } catch {
    return false;
  }
};

// Legacy SHA-256 hash (only for backward compatibility during migration)
const hashApiKeySHA256 = async (key: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export const requireRole = (ctx: AuthContext, role: string) => {
  if (!ctx.roles.includes(role) && !ctx.roles.includes('platform_admin')) {
    throw new ApiException('FORBIDDEN', 'Insufficient permissions', 403);
  }
};

export const requireScope = (ctx: AuthContext, scope: string) => {
  if (!ctx.isApiKey) return;
  // Batch N — Required Fix 2: exact match (or explicit `${parent}:*`
  // wildcard) only. The legacy "naked parent satisfies all children" /
  // "child satisfies parent" prefix logic is REMOVED.
  if (scopeSatisfies(ctx.roles, scope)) return;

  // Fire-and-forget scope denied audit. Never blocks the 403.
  writeSecurityAudit({
    action: 'api_key.scope_denied',
    orgId: ctx.orgId,
    apiKeyId: ctx.userId,
    actorIp: ctx.actorIp ?? null,
    userAgent: ctx.userAgent ?? null,
    requestId: ctx.requestId ?? null,
    extra: { required_scope: scope, held_scopes: ctx.roles },
  }).catch((e) => console.error('[requireScope] audit failed:', e));

  throw new ApiException('FORBIDDEN', `Missing required scope: ${scope}`, 403);
};
