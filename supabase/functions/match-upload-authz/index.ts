import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";

/**
 * Match Upload Authorisation Probe
 *
 * Read-only diagnostic endpoint. Given a match_id, returns the exact
 * participant evaluation the storage RLS policy uses, so operators (and
 * the Documents tab itself) can see at a glance:
 *   - the caller's user id and profile org_id
 *   - the match's three org slots (initiator/buyer/seller)
 *   - which of those slots match the caller's org (resolved roles)
 *   - whether the caller is authorised to upload for this match
 *   - the storage path prefix the caller's session would use
 *
 * GET /match-upload-authz/:matchId
 */

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "match-upload-authz") parts.shift();
    const matchId = parts[0];

    if (!matchId || !uuidRegex.test(matchId)) {
      throw new ApiException("VALIDATION_ERROR", "match_id (UUID) required in path", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);
    const isPlatformAdmin = (authCtx.roles ?? []).includes("platform_admin");

    const { data: match, error: matchErr } = await supabase
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id, status")
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
    // The storage RLS INSERT policy admits the caller if the caller's org
    // matches one of the three slots OR the caller has the platform_admin
    // role. Keep this in lock-step with the policy in
    // `Users can upload match documents to their org`.
    const canUpload = isParticipant || isPlatformAdmin;

    const reason = !match
      ? "match_not_found"
      : !callerOrgId
      ? "caller_has_no_org"
      : isParticipant
      ? "participant_org_match"
      : isPlatformAdmin
      ? "platform_admin_override"
      : "org_not_on_match";

    const storagePathPrefix = callerOrgId
      ? `${callerOrgId}/${matchId}/poi/<doc_id>/<filename>`
      : null;

    return new Response(
      JSON.stringify({
        request_id: requestId,
        match_id: matchId,
        match_found: !!match,
        match_lookup_error: matchErr ? matchErr.message : null,
        caller: {
          user_id: actorUserId,
          api_key_id: actorApiKeyId,
          org_id: callerOrgId,
          rbac_roles: authCtx.roles ?? [],
          is_platform_admin: isPlatformAdmin,
        },
        match: {
          org_id: matchOrgId,
          buyer_org_id: buyerOrgId,
          seller_org_id: sellerOrgId,
          status: match?.status ?? null,
        },
        decision: {
          participant_roles: roles,
          is_participant: isParticipant,
          can_upload: canUpload,
          reason,
        },
        storage: {
          bucket: "match-documents",
          path_prefix: storagePathPrefix,
        },
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return errorResponse(err as Error, requestId, headers);
  }
});
