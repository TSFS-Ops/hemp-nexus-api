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
  
  // Hash the API key (in production, use proper hashing)
  const keyHash = await hashApiKey(apiKey);

  const { data: keyData, error } = await supabase
    .from('api_keys')
    .select('id, org_id, scopes, status')
    .eq('key_hash', keyHash)
    .eq('status', 'active')
    .single();

  if (error || !keyData) {
    throw new ApiException('UNAUTHORIZED', 'Invalid API key', 401);
  }

  // Update last_used_at
  await supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyData.id);

  return {
    userId: '', // API keys don't have user context
    orgId: keyData.org_id,
    roles: keyData.scopes || [],
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

const hashApiKey = async (key: string): Promise<string> => {
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
