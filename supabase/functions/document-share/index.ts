import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { checkMaintenanceMode } from "../_shared/test-mode-bypass.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

/**
 * Document Share Endpoint
 * 
 * Allows document uploaders to change visibility settings and manage access grants.
 * 
 * PATCH /document-share/:documentId
 * Body:
 *   - visibility: "private" | "share_with_counterparty" | "share_with_roles"
 *   - grants: Array of { org_id?: string, user_id?: string, access_type: "view" | "download" }
 *             (only for share_with_roles)
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "PATCH") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }
    assertIdempotencyKey(req);

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    
    // Normalize path
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "document-share") parts.shift();
    
    const documentId = parts[0];

    if (!documentId) {
      throw new ApiException("BAD_REQUEST", "Document ID is required", 400);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(documentId)) {
      throw new ApiException("VALIDATION_ERROR", "Invalid document ID format", 400);
    }

    const body = await req.json();
    const { visibility, grants } = body;

    // Validate visibility
    const validVisibilities = ["private", "share_with_counterparty", "share_with_roles"];
    if (visibility && !validVisibilities.includes(visibility)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        `Invalid visibility. Must be one of: ${validVisibilities.join(", ")}`,
        400
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    console.log(`[${requestId}] PATCH /document-share/${documentId} by user ${authCtx.userId}`);

    // ── Maintenance gate (platform admins exempt) ──
    const maintenance = await checkMaintenanceMode(supabase, {
      source: "document-share",
      requestId,
      actorUserId: authCtx.userId,
      orgId: authCtx.orgId,
      action: "document_share_update",
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

    // Fetch document
    const { data: document, error: docError } = await supabase
      .from("match_documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docError) {
      if (docError.code === "PGRST116") {
        throw new ApiException("NOT_FOUND", "Document not found", 404);
      }
      handleDatabaseError(docError, requestId);
    }

    // Check ownership (only uploader org can change visibility)
    const uploaderOrgId = document.uploader_org_id || document.org_id;
    const isAdmin = authCtx.roles.includes("platform_admin");

    if (uploaderOrgId !== authCtx.orgId && !isAdmin) {
      throw new ApiException(
        "FORBIDDEN",
        "Only the document uploader can change visibility settings",
        403
      );
    }

    const oldVisibility = document.visibility;
    const updates: Record<string, unknown> = {};

    if (visibility && visibility !== oldVisibility) {
      updates.visibility = visibility;
    }

    // Update document if visibility changed
    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from("match_documents")
        .update(updates)
        .eq("id", documentId);

      if (updateError) handleDatabaseError(updateError, requestId);

      // Log visibility change
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "document.visibility_changed",
        entity_type: "match_document",
        entity_id: documentId,
        metadata: {
          match_id: document.match_id,
          old_visibility: oldVisibility,
          new_visibility: visibility,
          filename: document.filename,
        },
      });

      // Log to access logs
      await supabase.from("document_access_logs").insert({
        document_id: documentId,
        match_id: document.match_id,
        accessor_user_id: authCtx.userId,
        accessor_org_id: authCtx.orgId,
        action: "visibility_change",
        is_admin_access: isAdmin,
        metadata: {
          old_visibility: oldVisibility,
          new_visibility: visibility,
        },
      });
    }

    // Handle explicit grants for share_with_roles
    if (visibility === "share_with_roles" && Array.isArray(grants) && grants.length > 0) {
      const grantRecords = grants.map((grant: { org_id?: string; user_id?: string; access_type?: string }) => ({
        document_id: documentId,
        granted_to_org_id: grant.org_id || null,
        granted_to_user_id: grant.user_id || null,
        granted_by_user_id: authCtx.userId,
        access_type: grant.access_type || "view",
      }));

      const { error: grantError } = await supabase
        .from("document_access")
        .insert(grantRecords);

      if (grantError) {
        console.error(`[${requestId}] Failed to create grants:`, grantError);
      } else {
        // Log shared event
        await supabase.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
          actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
          action: "document.shared",
          entity_type: "match_document",
          entity_id: documentId,
          metadata: {
            match_id: document.match_id,
            grants_count: grants.length,
            grant_details: grants,
            filename: document.filename,
          },
        });
      }
    }

    // Fetch current grants
    const { data: currentGrants } = await supabase
      .from("document_access")
      .select("*")
      .eq("document_id", documentId)
      .is("revoked_at", null);

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          document_id: documentId,
          visibility: visibility || document.visibility,
          grants: currentGrants || [],
          message: "Document sharing settings updated successfully",
        },
      }),
      {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
