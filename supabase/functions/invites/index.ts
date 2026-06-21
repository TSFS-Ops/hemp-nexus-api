import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { checkMaintenanceMode } from "../_shared/test-mode-bypass.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { validateInput } from "../_shared/validation.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

const MAX_BODY_SIZE = 64 * 1024;

// Validation schemas
const inviteCreateSchema = z.object({
  to_email: z.string().email().max(255).nullish(),
  to_org_id: z.string().uuid().nullish(),
  search_query: z.string().max(500).nullish(),
  search_results: z.array(z.record(z.unknown())).max(50).optional(),
  selected_result_id: z.string().min(1).max(200),
  selected_result_data: z.record(z.unknown()),
});

const declineSchema = z.object({
  reason: z.string().max(1000).nullish(),
});

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const inviteId = pathParts.length > 1 ? pathParts[1] : null;
    const action = pathParts.length > 2 ? pathParts[2] : null;

    // Authenticate
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);
    console.log(`[${requestId}] ${req.method} /invites${inviteId ? `/${inviteId}` : ""}${action ? `/${action}` : ""} org:${authCtx.orgId}`);

    // ── Maintenance gate: block mutating methods (GET listings stay available) ──
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      const maintenance = await checkMaintenanceMode(supabase, {
        source: "invites",
        requestId,
        actorUserId: authCtx.userId,
        orgId: authCtx.orgId,
        action: `invites:${req.method}:${action ?? "root"}`,
      });
      if (maintenance.blocked) {
        return new Response(
          JSON.stringify({
            error: "Service temporarily unavailable — platform is in maintenance mode.",
            code: "MAINTENANCE_MODE",
            requestId,
          }),
          { status: 503, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }
    }

    // Helper: fetch invite and verify it exists + is pending
    const fetchPendingInvite = async (id: string) => {
      const { data: invite, error } = await supabase
        .from("invites")
        .select("*")
        .eq("id", id)
        .single();
      if (error || !invite) throw new ApiException("NOT_FOUND", "Invite not found", 404);
      if (invite.status !== "pending") throw new ApiException("INVALID_STATE", `Invite is already ${invite.status}`, 400);
      return invite;
    };

    // Helper: verify caller is the recipient
    const verifyRecipient = async (invite: any) => {
      const { data: userData } = await supabase.auth.admin.getUserById(authCtx.userId);
      const userEmail = userData.user?.email;
      const isRecipient =
        (invite.to_org_id && invite.to_org_id === authCtx.orgId) ||
        (invite.to_email && invite.to_email === userEmail);
      if (!isRecipient) throw new ApiException("FORBIDDEN", "You are not the recipient of this invite", 403);
    };

    // Helper: write audit log
    const writeAuditLog = async (action: string, entityId: string, metadata: Record<string, unknown>) => {
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action,
        entity_type: "invite",
        entity_id: entityId,
        metadata: { ...metadata, request_id: requestId },
      });
    };

    // ── POST /invites/:id/accept ──
    if (req.method === "POST" && inviteId && action === "accept") {
      assertIdempotencyKey(req);
      const invite = await fetchPendingInvite(inviteId);
      await verifyRecipient(invite);

      const { error: updateError } = await supabase
        .from("invites")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          to_org_id: authCtx.orgId,
        })
        .eq("id", inviteId);
      if (updateError) handleDatabaseError(updateError, requestId);

      await writeAuditLog("invite.accepted", inviteId, {
        from_org_id: invite.from_org_id,
        search_query: invite.search_query,
      });

      return new Response(
        JSON.stringify({ success: true, invite_id: inviteId, status: "accepted" }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── POST /invites/:id/decline ──
    if (req.method === "POST" && inviteId && action === "decline") {
      assertIdempotencyKey(req);
      const body = await req.json().catch(() => ({}));
      const { reason } = validateInput(declineSchema, body);

      const invite = await fetchPendingInvite(inviteId);
      await verifyRecipient(invite);

      const { error: updateError } = await supabase
        .from("invites")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
          declined_reason: reason || null,
          to_org_id: authCtx.orgId,
        })
        .eq("id", inviteId);
      if (updateError) handleDatabaseError(updateError, requestId);

      await writeAuditLog("invite.declined", inviteId, {
        from_org_id: invite.from_org_id,
        reason: reason || null,
      });

      return new Response(
        JSON.stringify({ success: true, invite_id: inviteId, status: "declined" }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── GET /invites ── List invites
    if (req.method === "GET" && !inviteId) {
      const type = url.searchParams.get("type") || "all";
      const status = url.searchParams.get("status") || null;
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      const { data: userData } = await supabase.auth.admin.getUserById(authCtx.userId);
      const userEmail = userData.user?.email;

      let query = supabase
        .from("invites")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (type === "sent") {
        query = query.eq("from_org_id", authCtx.orgId);
      } else if (type === "received") {
        query = query.or(`to_org_id.eq.${authCtx.orgId},to_email.eq.${userEmail}`);
      } else {
        query = query.or(`from_org_id.eq.${authCtx.orgId},to_org_id.eq.${authCtx.orgId},to_email.eq.${userEmail}`);
      }

      if (status) query = query.eq("status", status);

      const { data: invites, error, count } = await query;
      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ items: invites || [], totalCount: count || 0, limit, offset }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── GET /invites/:id ── Single invite
    if (req.method === "GET" && inviteId) {
      const { data: invite, error } = await supabase
        .from("invites")
        .select("*")
        .eq("id", inviteId)
        .single();
      if (error || !invite) throw new ApiException("NOT_FOUND", "Invite not found", 404);

      const { data: userData } = await supabase.auth.admin.getUserById(authCtx.userId);
      const userEmail = userData.user?.email;
      const hasAccess =
        invite.from_org_id === authCtx.orgId ||
        invite.to_org_id === authCtx.orgId ||
        invite.to_email === userEmail ||
        authCtx.roles.includes("platform_admin");
      if (!hasAccess) throw new ApiException("FORBIDDEN", "You do not have access to this invite", 403);

      return new Response(
        JSON.stringify(invite),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── POST /invites ── Create invite
    if (req.method === "POST" && !inviteId) {
      assertIdempotencyKey(req);
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        throw new ApiException("PAYLOAD_TOO_LARGE", "Request body too large", 413);
      }

      const body = await req.json();
      const validated = validateInput(inviteCreateSchema, body);

      const invite = {
        from_user_id: actorUserId,
        from_org_id: authCtx.orgId,
        to_email: validated.to_email || null,
        to_org_id: validated.to_org_id || null,
        search_query: validated.search_query || null,
        search_results: validated.search_results || [],
        selected_result_id: validated.selected_result_id,
        selected_result_data: validated.selected_result_data,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const { data: newInvite, error } = await supabase
        .from("invites")
        .insert(invite)
        .select()
        .single();
      if (error) handleDatabaseError(error, requestId);

      await writeAuditLog("invite.created", newInvite.id, {
        to_email: validated.to_email,
        to_org_id: validated.to_org_id,
        search_query: validated.search_query,
      });

      return new Response(
        JSON.stringify(newInvite),
        { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(
      error instanceof Error ? error : new Error("Unknown error"),
      requestId,
      headers
    );
  }
});
