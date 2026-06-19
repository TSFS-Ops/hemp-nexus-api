import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException, handleDatabaseError } from '../_shared/errors.ts';
import { authenticateRequest, hashApiKey, requireScope } from '../_shared/auth.ts';
import { apiKeyCreateSchema, validateInput } from '../_shared/validation.ts';
import { deriveActorIds } from '../_shared/actor-context.ts';
import { assertIdempotencyKey } from '../_shared/idempotency.ts';

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

    if (authCtx.isApiKey) {
      requireScope(authCtx, 'api_keys');
    }

    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);

    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    // Normalize: strip functions/v1/api-keys prefix
    const parts = [...pathParts];
    if (parts[0] === 'functions') parts.shift();
    if (parts[0] === 'v1') parts.shift();
    if (parts[0] === 'api-keys') parts.shift();

    // POST / - Create new API key
    if (req.method === 'POST' && parts.length === 0) {
      assertIdempotencyKey(req);
      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(apiKeyCreateSchema, rawBody);
      } catch (error) {
        throw new ApiException('VALIDATION_ERROR', error instanceof Error ? error.message : 'Invalid input', 400);
      }

      const { name, scopes, expires_at, allowed_ips, allowed_origins, api_client_id, environment } = validatedData;

      const apiKey = `sk_${crypto.randomUUID().replace(/-/g, '')}`;
      const keyHash = await hashApiKey(apiKey);

      // Public API V1 · Batch 2 — DB trigger api_keys_v1_client_gate enforces:
      //  • api_client must exist and not be suspended/revoked,
      //  • sandbox keys require sandbox_approved,
      //  • production keys require production_approved + full checklist +
      //    (allowed_ips OR an active approved IP allowlist exception).
      // We map those DB exceptions to clean 4xx responses + targeted audits.
      const insertPayload: Record<string, unknown> = {
        org_id: authCtx.orgId,
        name,
        key_hash: keyHash,
        scopes: scopes || [],
        created_by: actorUserId,
        expires_at: expires_at || null,
        allowed_ips: allowed_ips ?? null,
        allowed_origins: allowed_origins ?? null,
      };
      if (api_client_id) insertPayload.api_client_id = api_client_id;
      if (environment) insertPayload.environment = environment;

      const { data, error } = await supabase
        .from('api_keys')
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        const msg = error.message || '';
        // Map known trigger gate failures to audited blocks
        const gateCodes = [
          'API_CLIENT_NOT_FOUND',
          'API_CLIENT_BLOCKED_STATUS_suspended',
          'API_CLIENT_BLOCKED_STATUS_revoked',
          'API_CLIENT_PRODUCTION_NOT_APPROVED',
          'API_CLIENT_PRODUCTION_CHECKLIST_INCOMPLETE',
          'API_KEY_PRODUCTION_REQUIRES_IP_ALLOWLIST_OR_EXCEPTION',
          'API_CLIENT_SANDBOX_NOT_APPROVED',
          'API_CLIENT_COMMERCIAL_OWNER_SIGN_OFF_REQUIRED',
          'API_CLIENT_COMPLIANCE_OWNER_SIGN_OFF_REQUIRED',
          'API_KEY_PRODUCTION_EXPIRY_EXCEEDS_12_MONTHS',
          'API_KEY_SANDBOX_EXPIRY_EXCEEDS_90_DAYS',
        ];
        const matchedCode = gateCodes.find((c) => msg.includes(c));
        if (matchedCode) {
          // Sandprod Batch-3 canonical block audit for production-key
          // attempts. Legacy audit kept alongside for back-compat.
          const isProdAttempt = environment === 'production';
          const canonicalBlock = isProdAttempt
            ? (matchedCode === 'API_CLIENT_PRODUCTION_CHECKLIST_INCOMPLETE'
               ? 'api.production_access.checklist_failed'
               : 'api.production_key.creation_blocked')
            : 'api_key.blocked.client_status';
          const legacyBlock = matchedCode.startsWith('API_KEY_PRODUCTION_REQUIRES_IP')
            ? 'api_key.blocked.production_ip_required'
            : matchedCode.startsWith('API_CLIENT_PRODUCTION')
              ? 'api_key.blocked.production_not_approved'
              : matchedCode.startsWith('API_CLIENT_SANDBOX')
                ? 'api_key.blocked.sandbox_not_approved'
                : 'api_key.blocked.client_status';
          const blockMeta = {
            gate_code: matchedCode,
            environment: environment ?? null,
            request_id: requestId,
            actor_ip: authCtx.actorIp ?? null,
          };
          await supabase.from('audit_logs').insert([
            { org_id: authCtx.orgId, actor_user_id: actorUserId, actor_api_key_id: actorApiKeyId,
              action: canonicalBlock, entity_type: 'api_client', entity_id: api_client_id, metadata: blockMeta },
            { org_id: authCtx.orgId, actor_user_id: actorUserId, actor_api_key_id: actorApiKeyId,
              action: legacyBlock, entity_type: 'api_client', entity_id: api_client_id, metadata: blockMeta },
          ]);
          throw new ApiException('FORBIDDEN', `API key issuance blocked: ${matchedCode}`, 403);
        }
        handleDatabaseError(error, requestId);
      }

      // Emit canonical sandprod Batch-3 audit name for sandbox/production
      // alongside legacy api_key.created.* for back-compat.
      const canonicalAudit = environment === 'production'
        ? 'api.production_key.created'
        : environment === 'sandbox'
          ? 'api.sandbox_key.created'
          : 'api_key.created';
      const legacyAudit = environment === 'production'
        ? 'api_key.created.production'
        : environment === 'sandbox'
          ? 'api_key.created.sandbox'
          : 'api_key.created';
      const auditMeta = {
        name,
        scopes,
        environment: environment ?? null,
        api_client_id: api_client_id ?? null,
        allowed_ips: allowed_ips ?? null,
        allowed_origins: allowed_origins ?? null,
        request_id: requestId,
        actor_ip: authCtx.actorIp ?? null,
        user_agent: authCtx.userAgent ?? null,
        expires_at: data.expires_at ?? null,
      };
      await supabase.from('audit_logs').insert([
        { org_id: authCtx.orgId, actor_user_id: actorUserId, actor_api_key_id: actorApiKeyId,
          action: canonicalAudit, entity_type: 'api_key', entity_id: data.id, metadata: auditMeta },
        { org_id: authCtx.orgId, actor_user_id: actorUserId, actor_api_key_id: actorApiKeyId,
          action: legacyAudit, entity_type: 'api_key', entity_id: data.id, metadata: auditMeta },
      ]);

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

    // GET / - List API keys
    if (req.method === 'GET' && parts.length === 0) {
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, scopes, last_used_at, created_at, status, expires_at, environment, allowed_ips, allowed_origins')
        .eq('org_id', authCtx.orgId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // POST /:id/rotate - Rotate API key (revoke old, create new with same config)
    if (req.method === 'POST' && parts.length === 2 && parts[1] === 'rotate') {
      const keyId = parts[0];

      // Fetch existing key config — Batch 2: preserve api_client_id, environment, allowed_ips, allowed_origins
      const { data: existingKey, error: fetchErr } = await supabase
        .from('api_keys')
        .select('id, name, scopes, expires_at, org_id, key_history, api_client_id, environment, allowed_ips, allowed_origins')
        .eq('id', keyId)
        .eq('org_id', authCtx.orgId)
        .eq('status', 'active')
        .single();

      if (fetchErr || !existingKey) {
        throw new ApiException('NOT_FOUND', 'API key not found or already revoked', 404);
      }

      // Revoke old key
      await supabase
        .from('api_keys')
        .update({ 
          status: 'revoked', 
          revoked_at: new Date().toISOString(),
          key_history: [
            ...((existingKey.key_history as Array<unknown>) || []),
            { rotated_at: new Date().toISOString(), rotated_by: actorUserId }
          ],
        })
        .eq('id', keyId);

      // Create new key with same config
      const newApiKey = `sk_${crypto.randomUUID().replace(/-/g, '')}`;
      const newKeyHash = await hashApiKey(newApiKey);

      // Calculate new expiry if original had one
      let newExpiresAt = existingKey.expires_at;
      if (newExpiresAt) {
        const originalExpiry = new Date(newExpiresAt);
        const now = new Date();
        if (originalExpiry <= now) {
          // If expired, set to 90 days from now
          newExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
        }
      }

      const { data: newKey, error: createErr } = await supabase
        .from('api_keys')
        .insert({
          org_id: authCtx.orgId,
          name: existingKey.name,
          key_hash: newKeyHash,
          scopes: existingKey.scopes,
          created_by: actorUserId,
          expires_at: newExpiresAt,
          key_history: [{ rotated_from: keyId, rotated_at: new Date().toISOString() }],
          // Batch 2 — preserve linkage, environment, and IP/origin allowlists across rotation
          api_client_id: (existingKey as Record<string, unknown>).api_client_id ?? null,
          environment: (existingKey as Record<string, unknown>).environment ?? null,
          allowed_ips: (existingKey as Record<string, unknown>).allowed_ips ?? null,
          allowed_origins: (existingKey as Record<string, unknown>).allowed_origins ?? null,
        })
        .select()
        .single();

      if (createErr) handleDatabaseError(createErr, requestId);

      // Audit log
      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: 'api_key.rotated',
        entity_type: 'api_key',
        entity_id: newKey.id,
        metadata: {
          previous_key_id: keyId,
          new_key_id: newKey.id,
          request_id: requestId,
          actor_ip: authCtx.actorIp ?? null,
          user_agent: authCtx.userAgent ?? null,
        },
      });

      return new Response(
        JSON.stringify({
          id: newKey.id,
          name: newKey.name,
          key: newApiKey,
          scopes: newKey.scopes,
          expires_at: newKey.expires_at,
          created_at: newKey.created_at,
          rotated_from: keyId,
          message: "Key rotated. Old key has been revoked. Save this new key securely.",
        }),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // PATCH /:id - Rename API key
    if (req.method === 'PATCH' && parts.length === 1) {
      const keyId = parts[0];
      const body = await req.json();
      const newName = typeof body?.name === 'string' ? body.name.trim() : '';
      if (!newName || newName.length > 100) {
        throw new ApiException('VALIDATION_ERROR', 'name must be 1-100 chars', 400);
      }

      const { data, error } = await supabase
        .from('api_keys')
        .update({ name: newName })
        .eq('id', keyId)
        .eq('org_id', authCtx.orgId)
        .eq('status', 'active')
        .select('id, name')
        .single();

      if (error || !data) {
        throw new ApiException('NOT_FOUND', 'API key not found', 404);
      }

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: 'api_key.renamed',
        entity_type: 'api_key',
        entity_id: keyId,
        metadata: { name: newName, request_id: requestId, actor_ip: authCtx.actorIp ?? null, user_agent: authCtx.userAgent ?? null },
      });

      return new Response(
        JSON.stringify({ id: data.id, name: data.name }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // DELETE /:id - Revoke API key
    if (req.method === 'DELETE' && parts.length === 1) {
      const keyId = parts[0];

      const { error } = await supabase
        .from('api_keys')
        .update({ status: 'revoked', revoked_at: new Date().toISOString() })
        .eq('id', keyId)
        .eq('org_id', authCtx.orgId);

      if (error) handleDatabaseError(error, requestId);

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: 'api_key.revoked',
        entity_type: 'api_key',
        entity_id: keyId,
        metadata: { request_id: requestId, actor_ip: authCtx.actorIp ?? null, user_agent: authCtx.userAgent ?? null },
      });

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
