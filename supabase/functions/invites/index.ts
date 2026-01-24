import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

const MAX_BODY_SIZE = 64 * 1024; // 64KB

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
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
    // pathParts: ["invites"] or ["invites", ":id"] or ["invites", ":id", "accept"|"decline"]
    
    const inviteId = pathParts.length > 1 ? pathParts[1] : null;
    const action = pathParts.length > 2 ? pathParts[2] : null;

    // Authenticate request
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    console.log(`[${requestId}] ${req.method} /invites${inviteId ? `/${inviteId}` : ""}${action ? `/${action}` : ""} - org: ${authCtx.orgId}`);

    // POST /invites/:id/accept
    if (req.method === "POST" && inviteId && action === "accept") {
      // Verify invite exists and is pending
      const { data: invite, error: fetchError } = await supabase
        .from("invites")
        .select("*")
        .eq("id", inviteId)
        .single();

      if (fetchError || !invite) {
        throw new ApiException("NOT_FOUND", "Invite not found", 404);
      }

      if (invite.status !== "pending") {
        throw new ApiException("INVALID_STATE", `Invite is already ${invite.status}`, 400);
      }

      // Verify recipient is authorized (to_org_id matches or to_email matches user's email)
      const { data: userData } = await supabase.auth.admin.getUserById(authCtx.userId);
      const userEmail = userData.user?.email;

      const isRecipient = 
        (invite.to_org_id && invite.to_org_id === authCtx.orgId) ||
        (invite.to_email && invite.to_email === userEmail);

      if (!isRecipient) {
        throw new ApiException("FORBIDDEN", "You are not the recipient of this invite", 403);
      }

      // Update invite to accepted
      const { error: updateError } = await supabase
        .from("invites")
        .update({
          status: "accepted",
          accepted_at: new Date().toISOString(),
          to_org_id: authCtx.orgId, // Link the accepting org
        })
        .eq("id", inviteId);

      if (updateError) handleDatabaseError(updateError, requestId);

      // Write audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        action: "invite.accepted",
        entity_type: "invite",
        entity_id: inviteId,
        metadata: {
          from_org_id: invite.from_org_id,
          search_query: invite.search_query,
          request_id: requestId,
        },
      });

      return new Response(
        JSON.stringify({ success: true, invite_id: inviteId, status: "accepted" }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // POST /invites/:id/decline
    if (req.method === "POST" && inviteId && action === "decline") {
      const body = await req.json().catch(() => ({}));
      const reason = body.reason || null;

      const { data: invite, error: fetchError } = await supabase
        .from("invites")
        .select("*")
        .eq("id", inviteId)
        .single();

      if (fetchError || !invite) {
        throw new ApiException("NOT_FOUND", "Invite not found", 404);
      }

      if (invite.status !== "pending") {
        throw new ApiException("INVALID_STATE", `Invite is already ${invite.status}`, 400);
      }

      // Verify recipient
      const { data: userData } = await supabase.auth.admin.getUserById(authCtx.userId);
      const userEmail = userData.user?.email;

      const isRecipient = 
        (invite.to_org_id && invite.to_org_id === authCtx.orgId) ||
        (invite.to_email && invite.to_email === userEmail);

      if (!isRecipient) {
        throw new ApiException("FORBIDDEN", "You are not the recipient of this invite", 403);
      }

      // Update invite to declined
      const { error: updateError } = await supabase
        .from("invites")
        .update({
          status: "declined",
          declined_at: new Date().toISOString(),
          declined_reason: reason,
          to_org_id: authCtx.orgId,
        })
        .eq("id", inviteId);

      if (updateError) handleDatabaseError(updateError, requestId);

      // Write audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        action: "invite.declined",
        entity_type: "invite",
        entity_id: inviteId,
        metadata: {
          from_org_id: invite.from_org_id,
          reason: reason,
          request_id: requestId,
        },
      });

      return new Response(
        JSON.stringify({ success: true, invite_id: inviteId, status: "declined" }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // GET /invites - List invites (sent and received)
    if (req.method === "GET" && !inviteId) {
      const type = url.searchParams.get("type") || "all"; // "sent", "received", "all"
      const status = url.searchParams.get("status") || null;
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
      const offset = parseInt(url.searchParams.get("offset") || "0");

      // Get user's email for matching received invites
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
        // Received = to_org_id matches OR to_email matches
        query = query.or(`to_org_id.eq.${authCtx.orgId},to_email.eq.${userEmail}`);
      } else {
        // All = sent OR received
        query = query.or(`from_org_id.eq.${authCtx.orgId},to_org_id.eq.${authCtx.orgId},to_email.eq.${userEmail}`);
      }

      if (status) {
        query = query.eq("status", status);
      }

      const { data: invites, error, count } = await query;

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({
          items: invites || [],
          totalCount: count || 0,
          limit,
          offset,
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // GET /invites/:id - Get single invite
    if (req.method === "GET" && inviteId) {
      const { data: invite, error } = await supabase
        .from("invites")
        .select("*")
        .eq("id", inviteId)
        .single();

      if (error || !invite) {
        throw new ApiException("NOT_FOUND", "Invite not found", 404);
      }

      // Verify access (sender or recipient)
      const { data: userData } = await supabase.auth.admin.getUserById(authCtx.userId);
      const userEmail = userData.user?.email;

      const hasAccess = 
        invite.from_org_id === authCtx.orgId ||
        invite.to_org_id === authCtx.orgId ||
        invite.to_email === userEmail ||
        authCtx.roles.includes("admin");

      if (!hasAccess) {
        throw new ApiException("FORBIDDEN", "You do not have access to this invite", 403);
      }

      return new Response(
        JSON.stringify(invite),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // POST /invites - Create new invite
    if (req.method === "POST" && !inviteId) {
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        throw new ApiException("PAYLOAD_TOO_LARGE", "Request body too large", 413);
      }

      const body = await req.json();
      
      // Validate required fields
      if (!body.selected_result_id || !body.selected_result_data) {
        throw new ApiException("VALIDATION_ERROR", "selected_result_id and selected_result_data are required", 400);
      }

      const invite = {
        from_user_id: authCtx.userId,
        from_org_id: authCtx.orgId,
        to_email: body.to_email || null,
        to_org_id: body.to_org_id || null,
        search_query: body.search_query || null,
        search_results: body.search_results || [],
        selected_result_id: body.selected_result_id,
        selected_result_data: body.selected_result_data,
        status: "pending",
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      };

      const { data: newInvite, error } = await supabase
        .from("invites")
        .insert(invite)
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      // Write audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        action: "invite.created",
        entity_type: "invite",
        entity_id: newInvite.id,
        metadata: {
          to_email: body.to_email,
          to_org_id: body.to_org_id,
          search_query: body.search_query,
          request_id: requestId,
        },
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
