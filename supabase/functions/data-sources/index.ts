import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException, handleDatabaseError } from '../_shared/errors.ts';
import { authenticateRequest, requireScope } from '../_shared/auth.ts';
import { dataSourceCreateSchema, dataSourceUpdateSchema, validateInput } from '../_shared/validation.ts';
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
    requireScope(authCtx, 'data_sources');
    
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // POST /data-sources - Create data source connector
    if (req.method === 'POST' && pathParts.length === 1) {
      assertIdempotencyKey(req);
      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(dataSourceCreateSchema, rawBody);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { name, type, config } = validatedData;

      const { data, error } = await supabase
        .from('data_sources')
        .insert({
          org_id: authCtx.orgId,
          name,
          type,
          config: config || {},
        })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: 'data_source.created',
        entity_type: 'data_source',
        entity_id: data.id,
        metadata: { name, type },
      });

      return new Response(
        JSON.stringify(data),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // GET /data-sources - List data sources
    if (req.method === 'GET' && pathParts.length === 1) {
      const { data, error } = await supabase
        .from('data_sources')
        .select('*')
        .eq('org_id', authCtx.orgId)
        .order('created_at', { ascending: false });

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // GET /data-sources/:id - Get data source
    if (req.method === 'GET' && pathParts.length === 2) {
      const sourceId = pathParts[1];

      const { data, error } = await supabase
        .from('data_sources')
        .select('*')
        .eq('id', sourceId)
        .eq('org_id', authCtx.orgId)
        .single();

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // PATCH /data-sources/:id - Update data source
    if (req.method === 'PATCH' && pathParts.length === 2) {
      const sourceId = pathParts[1];
      const rawUpdates = await req.json();
      
      let updates;
      try {
        updates = validateInput(dataSourceUpdateSchema, rawUpdates);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { data, error } = await supabase
        .from('data_sources')
        .update(updates)
        .eq('id', sourceId)
        .eq('org_id', authCtx.orgId)
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: 'data_source.updated',
        entity_type: 'data_source',
        entity_id: sourceId,
        metadata: updates,
      });

      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // DELETE /data-sources/:id - Delete data source
    if (req.method === 'DELETE' && pathParts.length === 2) {
      const sourceId = pathParts[1];

      const { error } = await supabase
        .from('data_sources')
        .delete()
        .eq('id', sourceId)
        .eq('org_id', authCtx.orgId);

      if (error) handleDatabaseError(error, requestId);

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
