import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException, handleDatabaseError } from '../_shared/errors.ts';
import { authenticateRequest, hashApiKey, requireScope } from '../_shared/auth.ts';
import { apiKeyCreateSchema, validateInput } from '../_shared/validation.ts';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '*';
  const origin = req.headers.get('origin');
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireScope(authCtx, 'api_keys');
    
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // POST /api-keys - Create new API key
    if (req.method === 'POST' && pathParts.length === 1) {
      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(apiKeyCreateSchema, rawBody);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { name, scopes, expires_at } = validatedData;

      // Generate a random API key
      const apiKey = `sk_${crypto.randomUUID().replace(/-/g, '')}`;
      const keyHash = await hashApiKey(apiKey);

      const { data, error } = await supabase
        .from('api_keys')
        .insert({
          org_id: authCtx.orgId,
          name,
          key_hash: keyHash,
          scopes: scopes || [],
          created_by: authCtx.userId || null,
          expires_at: expires_at || null,
        })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      // Log audit trail
      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: 'api_key.created',
        entity_type: 'api_key',
        entity_id: data.id,
        metadata: { name, scopes },
      });

      return new Response(
        JSON.stringify({ 
          id: data.id,
          name: data.name,
          key: apiKey,
          scopes: data.scopes,
          expires_at: data.expires_at,
          created_at: data.created_at,
        }),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // GET /api-keys - List API keys
    if (req.method === 'GET' && pathParts.length === 1) {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, scopes, last_used_at, created_at, status, expires_at')
        .eq('org_id', authCtx.orgId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // DELETE /api-keys/:id - Revoke API key
    if (req.method === 'DELETE' && pathParts.length === 2) {
      const keyId = pathParts[1];

      const { error } = await supabase
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', keyId)
        .eq('org_id', authCtx.orgId);

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: 'api_key.revoked',
        entity_type: 'api_key',
        entity_id: keyId,
      });

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
