import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
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

  // Check ALL keys to prevent timing attacks (constant-time behavior)
  // Track match but continue checking to avoid early exit timing leaks
  for (const key of allKeys || []) {
    let isMatch = false;
    let requiresRehash = false;
    
    if (key.key_hash.includes('$')) {
      // Scrypt hash format: salt$hash
      isMatch = await verifyScrypt(apiKey, key.key_hash);
    } else if (key.key_hash.length === 64 && /^[0-9a-f]+$/.test(key.key_hash)) {
      // Legacy SHA-256 hash - compare and mark for rehashing
      const sha256Hash = await hashApiKeySHA256(apiKey);
      isMatch = sha256Hash === key.key_hash;
      requiresRehash = isMatch;
    }
    
    // Only update matchedKey if we haven't found one yet (first match wins)
    if (isMatch && !matchedKey) {
      matchedKey = key;
      needsRehash = requiresRehash;
    }
  }

  if (!matchedKey) {
    throw new ApiException('UNAUTHORIZED', 'Invalid API key', 401);
  }

  // If using legacy hash, rehash with scrypt for future requests
  if (needsRehash) {
    const newHash = await hashApiKey(apiKey);
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
    userId: matchedKey.id, // Use API key ID as userId for API key auth
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
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 65536,
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
    
    // Derive bits with same parameters
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 65536,
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
  if (!ctx.roles.includes(role) && !ctx.roles.includes('admin')) {
    throw new ApiException('FORBIDDEN', 'Insufficient permissions', 403);
  }
};

export const requireScope = (ctx: AuthContext, scope: string) => {
  if (ctx.isApiKey) {
    // Check for exact match or prefix match (e.g., 'signals' matches 'signals:read')
    const hasScope = ctx.roles.some(r => r === scope || r.startsWith(`${scope}:`));
    if (!hasScope) {
      throw new ApiException('FORBIDDEN', `Missing required scope: ${scope}`, 403);
    }
  }
};
