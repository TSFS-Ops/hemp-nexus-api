import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

/**
 * Document Download Endpoint
 * 
 * Generates short-lived signed URLs for document downloads with access logging.
 * Enforces visibility rules and requires access_reason for admin downloads.
 * 
 * GET /document-download/:documentId
 * Query params:
 *   - access_reason: Required for admin access
 */
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
    const rawParts = url.pathname.split("/").filter(Boolean);
    
    // Normalize path
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "document-download") parts.shift();
    
    const documentId = parts[0];
    const accessReason = url.searchParams.get("access_reason");

    if (!documentId) {
      throw new ApiException("BAD_REQUEST", "Document ID is required", 400);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(documentId)) {
      throw new ApiException("VALIDATION_ERROR", "Invalid document ID format", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const isAdmin = authCtx.roles.includes("platform_admin");

    // Require access_reason for admin access
    if (isAdmin && !accessReason) {
      throw new ApiException(
        "BAD_REQUEST", 
        "Admin access requires an access_reason query parameter", 
        400
      );
    }

    console.log(`[${requestId}] GET /document-download/${documentId} by user ${authCtx.userId}`);

    // Fetch document with match info
    const { data: document, error: docError } = await supabase
      .from("match_documents")
      .select(`
        *,
        matches!inner (
          id,
          org_id,
          buyer_org_id,
          seller_org_id
        )
      `)
      .eq("id", documentId)
      .single();

    if (docError) {
      if (docError.code === "PGRST116") {
        throw new ApiException("NOT_FOUND", "Document not found", 404);
      }
      handleDatabaseError(docError, requestId);
    }

    // Check access permissions
    const uploaderOrgId = document.uploader_org_id || document.org_id;
    const matchOrgId = document.matches?.org_id;
    const buyerOrgId = document.matches?.buyer_org_id;
    const sellerOrgId = document.matches?.seller_org_id;
    const userOrgId = authCtx.orgId;

    let hasAccess = false;
    let accessType = "unknown";

    // Admin always has access
    if (isAdmin) {
      hasAccess = true;
      accessType = "admin";
    }
    // Uploader org always has access
    else if (uploaderOrgId === userOrgId || matchOrgId === userOrgId) {
      hasAccess = true;
      accessType = "owner";
    }
    // Check visibility for counterparty
    else if (document.visibility === "share_with_counterparty") {
      // Counterparty must be buyer or seller org
      if (buyerOrgId === userOrgId || sellerOrgId === userOrgId) {
        // Check document is not revoked
        if (!["revoked", "archived"].includes(document.status)) {
          hasAccess = true;
          accessType = "counterparty";
        }
      }
    }
    // Check explicit grants for share_with_roles
    else if (document.visibility === "share_with_roles") {
      const { data: grant } = await supabase
        .from("document_access")
        .select("id")
        .eq("document_id", documentId)
        .is("revoked_at", null)
        .or(`granted_to_org_id.eq.${userOrgId},granted_to_user_id.eq.${authCtx.userId}`)
        .limit(1)
        .single();

      if (grant && !["revoked", "archived"].includes(document.status)) {
        hasAccess = true;
        accessType = "explicit_grant";
      }
    }

    if (!hasAccess) {
      throw new ApiException("FORBIDDEN", "You do not have access to this document", 403);
    }

    // Log the access
    const { error: logError } = await supabase
      .from("document_access_logs")
      .insert({
        document_id: documentId,
        match_id: document.match_id,
        accessor_user_id: authCtx.userId,
        accessor_org_id: userOrgId,
        action: "download",
        access_reason: accessReason || null,
        is_admin_access: isAdmin,
        ip_address: req.headers.get("x-forwarded-for")?.split(",")[0] || req.headers.get("x-real-ip") || null,
        user_agent: req.headers.get("user-agent") || null,
        metadata: {
          access_type: accessType,
          document_visibility: document.visibility,
          request_id: requestId,
        },
      });

    if (logError) {
      console.error(`[${requestId}] Failed to log access:`, logError);
    }

    // Also log to audit_logs for audit trail
    await supabase.from("audit_logs").insert({
      org_id: userOrgId,
      actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
      action: isAdmin ? "admin.document.accessed" : "document.downloaded",
      entity_type: "match_document",
      entity_id: documentId,
      metadata: {
        match_id: document.match_id,
        filename: document.filename,
        access_type: accessType,
        access_reason: accessReason || null,
        visibility: document.visibility,
      },
    });

    // Generate signed URL (5 minute expiry)
    const { data: signedUrlData, error: signedUrlError } = await supabase
      .storage
      .from("match-documents")
      .createSignedUrl(document.storage_path, 300); // 5 minutes

    if (signedUrlError || !signedUrlData?.signedUrl) {
      console.error(`[${requestId}] Failed to generate signed URL:`, signedUrlError);
      throw new ApiException("INTERNAL_ERROR", "Failed to generate download URL", 500);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          download_url: signedUrlData.signedUrl,
          expires_in_seconds: 300,
          filename: document.filename,
          mime_type: document.mime_type,
          file_size: document.file_size,
          sha256_hash: document.sha256_hash,
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
