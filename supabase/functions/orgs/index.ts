import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException, handleDatabaseError } from '../_shared/errors.ts';
import { authenticateRequest, requireRole, requireScope } from '../_shared/auth.ts';
import { orgCreateSchema, orgUpdateSchema, validateInput } from '../_shared/validation.ts';
import { assertIdempotencyKey } from '../_shared/idempotency.ts';
import { assertAal2 } from '../_shared/aal.ts';

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
    requireRole(authCtx, 'platform_admin'); // Only admins can manage orgs
    requireScope(authCtx, 'orgs');

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorisation');

    // SEC-001: gate mutating organisation paths (POST/PATCH/DELETE) with AAL2.
    // GET (list/read) remains AAL1. API key callers (server-to-server) skip
    // the JWT-derived check since they have no `aal` claim.
    const requireMfaForOrgMutation = async (target?: { id?: string | null }) => {
      if (authCtx.isApiKey) return;
      await assertAal2(authHeader, {
        adminClient: supabase,
        callerUserId: authCtx.userId,
        action: 'organisation.mutate',
        context: {
          sensitive_action_category: 'governance.organisation',
          target_resource_type: 'organisation',
          target_resource_id: target?.id ?? null,
          method: req.method,
        },
      });
    };

    // GET /orgs - List organisations
    if (req.method === 'GET' && pathParts.length === 1) {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const status = url.searchParams.get('status');

      let query = supabase
        .from('organizations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // POST /orgs - Create organisation
    if (req.method === 'POST' && pathParts.length === 1) {
      await requireMfaForOrgMutation();
      assertIdempotencyKey(req);
      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(orgCreateSchema, rawBody);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { name, status } = validatedData;

      const { data, error } = await supabase
        .from('organizations')
        .insert({ name, status: status || 'active' })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: data.id,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: 'organisation.created',
        entity_type: 'organisation',
        entity_id: data.id,
        metadata: { name },
      });

      return new Response(
        JSON.stringify(data),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // GET /orgs/:id - Get organisation
    if (req.method === 'GET' && pathParts.length === 2) {
      const orgId = pathParts[1];

      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', orgId)
        .single();

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // PATCH /orgs/:id - Update organisation
    if (req.method === 'PATCH' && pathParts.length === 2) {
      const orgId = pathParts[1];
      await requireMfaForOrgMutation({ id: orgId });
      const rawUpdates = await req.json();

      
      let updates;
      try {
        updates = validateInput(orgUpdateSchema, rawUpdates);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { data, error } = await supabase
        .from('organizations')
        .update(updates)
        .eq('id', orgId)
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: 'organisation.updated',
        entity_type: 'organisation',
        entity_id: orgId,
        metadata: updates,
      });

      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // DELETE /orgs/:id - Delete organisation
    if (req.method === 'DELETE' && pathParts.length === 2) {
      const orgId = pathParts[1];
      await requireMfaForOrgMutation({ id: orgId });

      const { error } = await supabase
        .from('organizations')
        .delete()
        .eq('id', orgId);

      if (error) handleDatabaseError(error, requestId);

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
