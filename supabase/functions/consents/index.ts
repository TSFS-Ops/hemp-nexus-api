import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException, handleDatabaseError } from '../_shared/errors.ts';
import { authenticateRequest, requireScope } from '../_shared/auth.ts';
import { consentCreateSchema, validateInput } from '../_shared/validation.ts';
import { assertIdempotencyKey } from '../_shared/idempotency.ts';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '';
  const origin = req.headers.get('origin');
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireScope(authCtx, 'consents');
    
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // POST /consents - Grant consent
    if (req.method === 'POST' && pathParts.length === 1) {
      assertIdempotencyKey(req);
      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(consentCreateSchema, rawBody);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { data_source_id, scope, expires_at } = validatedData;

      // Verify data source belongs to org
      const { data: dataSource } = await supabase
        .from('data_sources')
        .select('id')
        .eq('id', data_source_id)
        .eq('org_id', authCtx.orgId)
        .single();

      if (!dataSource) {
        throw new ApiException('NOT_FOUND', 'Data source not found', 404);
      }

      const { data, error } = await supabase
        .from('consents')
        .insert({
          org_id: authCtx.orgId,
          data_source_id,
          granted_by: authCtx.isApiKey ? null : authCtx.userId,
          scope: scope || {},
          expires_at,
        })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: 'consent.granted',
        entity_type: 'consent',
        entity_id: data.id,
        metadata: { data_source_id, scope },
      });

      return new Response(
        JSON.stringify(data),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // GET /consents - List consents
    if (req.method === 'GET' && pathParts.length === 1) {
      const { data, error } = await supabase
        .from('consents')
        .select('*, data_source:data_sources(*)')
        .eq('org_id', authCtx.orgId)
        .order('granted_at', { ascending: false });

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // DELETE /consents/:id - Revoke consent
    if (req.method === 'DELETE' && pathParts.length === 2) {
      const consentId = pathParts[1];

      const { error } = await supabase
        .from('consents')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', consentId)
        .eq('org_id', authCtx.orgId);

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: 'consent.revoked',
        entity_type: 'consent',
        entity_id: consentId,
      });

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
