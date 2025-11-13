import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';
import { ApiException } from './errors.ts';

export interface AuthContext {
  userId: string;
  orgId: string;
  roles: string[];
  isApiKey: boolean;
}

export const authenticateRequest = async (
  req: Request,
  supabaseUrl: string,
  supabaseKey: string
): Promise<AuthContext> => {
  const authHeader = req.headers.get('authorization');
  const apiKeyHeader = req.headers.get('x-api-key');

  // Check for API Key auth
  if (apiKeyHeader) {
    return await authenticateApiKey(apiKeyHeader, supabaseUrl, supabaseKey);
  }

  // Check for JWT auth
  if (authHeader?.startsWith('Bearer ')) {
    return await authenticateJwt(authHeader, supabaseUrl, supabaseKey);
  }

  throw new ApiException('UNAUTHORIZED', 'Missing authentication', 401);
};

const authenticateApiKey = async (
  apiKey: string,
  supabaseUrl: string,
  supabaseKey: string
): Promise<AuthContext> => {
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  // Try to find key using bcrypt comparison (for new keys)
  const { data: allKeys, error: fetchError } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes, status, key_hash')
    .eq('status', 'active');

  if (fetchError) {
    throw new ApiException('UNAUTHORIZED', 'Authentication failed', 401);
  }

  let matchedKey = null;
  let needsRehash = false;

  // Check each key - bcrypt hashes start with $2, SHA-256 hashes are 64 hex chars
  for (const key of allKeys || []) {
    if (key.key_hash.startsWith('$2')) {
      // Bcrypt hash - use bcrypt.compare
      if (await bcrypt.compare(apiKey, key.key_hash)) {
        matchedKey = key;
        break;
      }
    } else if (key.key_hash.length === 64 && /^[0-9a-f]+$/.test(key.key_hash)) {
      // Legacy SHA-256 hash - compare and mark for rehashing
      const sha256Hash = await hashApiKeySHA256(apiKey);
      if (sha256Hash === key.key_hash) {
        matchedKey = key;
        needsRehash = true;
        break;
      }
    }
  }

  if (!matchedKey) {
    throw new ApiException('UNAUTHORIZED', 'Invalid API key', 401);
  }

  // If using legacy hash, rehash with bcrypt for future requests
  if (needsRehash) {
    const newHash = await bcrypt.hash(apiKey);
    await supabase
      .from('api_keys')
      .update({ key_hash: newHash })
      .eq('id', matchedKey.id);
  }

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', matchedKey.id);

  return {
    userId: '', // API keys don't have user context
    orgId: matchedKey.org_id,
    roles: matchedKey.scopes || [],
    isApiKey: true,
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

// Hash API key using bcrypt (secure, slow hash for credentials)
export const hashApiKey = async (key: string): Promise<string> => {
  return await bcrypt.hash(key);
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
  if (!ctx.roles.includes(role) && !ctx.roles.includes('admin')) {
    throw new ApiException('FORBIDDEN', 'Insufficient permissions', 403);
  }
};

export const requireScope = (ctx: AuthContext, scope: string) => {
  if (ctx.isApiKey && !ctx.roles.includes(scope)) {
    throw new ApiException('FORBIDDEN', `Missing required scope: ${scope}`, 403);
  }
};
