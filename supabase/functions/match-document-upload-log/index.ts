import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";

/**
 * Match Document Upload Log Endpoint
 *
 * Structured server-side audit row for EVERY upload attempt the client makes
 * against the `match-documents` storage bucket — both successes and failures.
 *
 * Why this exists:
 *   Storage RLS rejections surface to the client as opaque errors with no
 *   request id, no participant evaluation, and no server-side trail. This
 *   endpoint accepts the client's view of the attempt, evaluates participant
 *   role(s) on the match server-side from the JWT, and writes a single
 *   audit row tagged `document.upload.attempt` with everything an operator
 *   needs to diagnose later: requesting user, profile org, match id, the
 *   three match org slots, the resolved role(s), the storage path, the
 *   storage status code/body, the db insert outcome, and a correlation id.
 *
 * Calling contract (POST):
 *   {
 *     match_id: uuid,
 *     storage_path: string,
 *     filename: string,
 *     file_size?: number,
 *     mime_type?: string,
 *     phase: 'storage_upload' | 'db_insert' | 'validation' | 'success',
 *     outcome: 'success' | 'failure',
 *     storage_status?: number | null,   // HTTP status from supabase.storage
 *     storage_error?: string | null,    // truncated error body/message
 *     db_error?: string | null,
 *     client_request_id?: string,       // correlation id chosen by the client
 *     document_id?: string | null,
 *   }
 *
 * Returns: { ok: true, server_request_id: string, evaluated: {...} }
 */

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ERR_LEN = 2000;

function clip(value: unknown, max = MAX_ERR_LEN): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

Deno.serve(async (req) => {
  const serverRequestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ApiException("BAD_REQUEST", "JSON body required", 400);
    }

    const matchId = String(body.match_id ?? "");
    if (!uuidRegex.test(matchId)) {
      throw new ApiException("VALIDATION_ERROR", "match_id must be a UUID", 400);
    }

    const phase = String(body.phase ?? "");
    const outcome = String(body.outcome ?? "");
    if (!["storage_upload", "db_insert", "validation", "success"].includes(phase)) {
      throw new ApiException("VALIDATION_ERROR", "phase invalid", 400);
    }
    if (!["success", "failure"].includes(outcome)) {
      throw new ApiException("VALIDATION_ERROR", "outcome must be success|failure", 400);
    }

    // Server-side participant evaluation — this is the canonical answer the
    // client cannot fake. We resolve the match's three org slots and compare
    // against the caller's profile org_id.
    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id")
      .eq("id", matchId)
      .maybeSingle();

    const callerOrgId = authCtx.orgId || null;
    const matchOrgId = match?.org_id ?? null;
    const buyerOrgId = match?.buyer_org_id ?? null;
    const sellerOrgId = match?.seller_org_id ?? null;

    const roles: string[] = [];
    if (callerOrgId && matchOrgId === callerOrgId) roles.push("initiator");
    if (callerOrgId && buyerOrgId === callerOrgId) roles.push("buyer");
    if (callerOrgId && sellerOrgId === callerOrgId) roles.push("seller");
    const isParticipant = roles.length > 0;

    const evaluated = {
      caller_user_id: actorUserId,
      caller_api_key_id: actorApiKeyId,
      caller_org_id: callerOrgId,
      caller_roles_rbac: authCtx.roles ?? [],
      match_id: matchId,
      match_found: !!match,
      match_org_id: matchOrgId,
      match_buyer_org_id: buyerOrgId,
      match_seller_org_id: sellerOrgId,
      participant_roles: roles,
      is_participant: isParticipant,
      match_lookup_error: matchErr ? clip(matchErr.message) : null,
    };

    const auditMetadata = {
      server_request_id: serverRequestId,
      client_request_id: body.client_request_id ?? null,
      phase,
      outcome,
      filename: clip(body.filename, 500),
      storage_path: clip(body.storage_path, 1000),
      file_size: typeof body.file_size === "number" ? body.file_size : null,
      mime_type: body.mime_type ?? null,
      storage_status: typeof body.storage_status === "number" ? body.storage_status : null,
      storage_error: clip(body.storage_error),
      db_error: clip(body.db_error),
      document_id: body.document_id ?? null,
      evaluated,
    };

    // Always emit a structured log line so it's grep-able from edge logs even
    // if the audit_logs insert itself fails.
    console.log(
      JSON.stringify({
        tag: "match-document-upload-log",
        server_request_id: serverRequestId,
        client_request_id: body.client_request_id ?? null,
        match_id: matchId,
        phase,
        outcome,
        caller_user_id: actorUserId,
        caller_org_id: callerOrgId,
        participant_roles: roles,
        is_participant: isParticipant,
        match_org_id: matchOrgId,
        match_buyer_org_id: buyerOrgId,
        match_seller_org_id: sellerOrgId,
        storage_status: auditMetadata.storage_status,
        storage_error: auditMetadata.storage_error,
        db_error: auditMetadata.db_error,
        storage_path: auditMetadata.storage_path,
      })
    );

    // Audit row. org_id MUST be NOT NULL on audit_logs — if the caller has no
    // org we still want the row, so fall back to the match's initiator org,
    // else the first non-null match slot.
    const auditOrgId =
      callerOrgId || matchOrgId || buyerOrgId || sellerOrgId;

    if (auditOrgId) {
      const { error: auditErr } = await supabase.from("audit_logs").insert({
        org_id: auditOrgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "document.upload.attempt",
        entity_type: "match_document",
        entity_id: matchId,
        metadata: auditMetadata,
      });
      if (auditErr) {
        console.error(
          JSON.stringify({
            tag: "match-document-upload-log.audit_insert_failed",
            server_request_id: serverRequestId,
            error: auditErr.message,
          })
        );
      }
    } else {
      console.warn(
        JSON.stringify({
          tag: "match-document-upload-log.no_org_for_audit",
          server_request_id: serverRequestId,
        })
      );
    }

    return new Response(
      JSON.stringify({ ok: true, server_request_id: serverRequestId, evaluated }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return errorResponse(err as Error, serverRequestId, headers);
  }
});
