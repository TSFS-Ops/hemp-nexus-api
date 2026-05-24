import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertNoLegalHold } from "../_shared/legal-hold.ts";

/**
 * Document Revoke Endpoint
 * 
 * Soft-revokes document access. Does NOT delete files from storage.
 * 
 * POST /document-revoke/:documentId
 * Body:
 *   - action: "revoke_document" | "revoke_grants"
 *   - grant_ids: Array of grant IDs to revoke (only for revoke_grants)
 *   - reason: Optional reason for revocation
 */
Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }
    assertIdempotencyKey(req);

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    
    // Normalize path
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "document-revoke") parts.shift();
    
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
    const { action, grant_ids, reason } = body;

    if (!action || !["revoke_document", "revoke_grants"].includes(action)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "action must be 'revoke_document' or 'revoke_grants'",
        400
      );
    }

    if (action === "revoke_grants" && (!Array.isArray(grant_ids) || grant_ids.length === 0)) {
      throw new ApiException(
        "VALIDATION_ERROR",
        "grant_ids array is required for revoke_grants action",
        400
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);

    console.log(`[${requestId}] POST /document-revoke/${documentId} action=${action} by user ${authCtx.userId}`);

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

    // Check ownership
    const uploaderOrgId = document.uploader_org_id || document.org_id;
    const isAdmin = authCtx.roles.includes("platform_admin");

    if (uploaderOrgId !== authCtx.orgId && !isAdmin) {
      throw new ApiException(
        "FORBIDDEN",
        "Only the document uploader can revoke access",
        403
      );
    }

    // DATA-003: refuse revocation/grant-revocation if the evidence
    // document or its match is under an active legal hold.
    const holdScopes: Array<{ scope_type: "evidence" | "match"; scope_id: string }> = [
      { scope_type: "evidence", scope_id: documentId },
    ];
    if (document.match_id) holdScopes.push({ scope_type: "match", scope_id: document.match_id });
    const docHold = await assertNoLegalHold(supabase, holdScopes, {
      action: `document-revoke.${action}`,
      actorUserId: authCtx.userId,
      actorOrgId: authCtx.orgId,
      requestId,
      relatedRequestId: documentId,
    });
    if (docHold.blocked) {
      throw new ApiException(
        "LEGAL_HOLD_ACTIVE",
        "Document revocation is blocked because an active legal hold exists for this scope.",
        409,
      );
    }

    if (action === "revoke_document") {
      // Soft-revoke the entire document
      const { error: updateError } = await supabase
        .from("match_documents")
        .update({ 
          status: "revoked",
          updated_at: new Date().toISOString(),
        })
        .eq("id", documentId);

      if (updateError) handleDatabaseError(updateError, requestId);

      // Also revoke all explicit grants
      await supabase
        .from("document_access")
        .update({ 
          revoked_at: new Date().toISOString(),
          revoked_by_user_id: authCtx.userId,
        })
        .eq("document_id", documentId)
        .is("revoked_at", null);

      // Log revocation
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "document.revoked",
        entity_type: "match_document",
        entity_id: documentId,
        metadata: {
          match_id: document.match_id,
          filename: document.filename,
          reason: reason || null,
          revocation_type: "full_document",
        },
      });

      // Log to access logs
      await supabase.from("document_access_logs").insert({
        document_id: documentId,
        match_id: document.match_id,
        accessor_user_id: authCtx.userId,
        accessor_org_id: authCtx.orgId,
        action: "revoke",
        is_admin_access: isAdmin,
        metadata: {
          reason: reason || null,
          revocation_type: "full_document",
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            document_id: documentId,
            status: "revoked",
            message: "Document access has been revoked. The file remains stored for retention.",
          },
        }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    if (action === "revoke_grants") {
      // Revoke specific grants
      const { data: revokedGrants, error: revokeError } = await supabase
        .from("document_access")
        .update({ 
          revoked_at: new Date().toISOString(),
          revoked_by_user_id: authCtx.userId,
        })
        .eq("document_id", documentId)
        .in("id", grant_ids)
        .is("revoked_at", null)
        .select();

      if (revokeError) handleDatabaseError(revokeError, requestId);

      // Log revocation
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "document.revoked",
        entity_type: "match_document",
        entity_id: documentId,
        metadata: {
          match_id: document.match_id,
          filename: document.filename,
          reason: reason || null,
          revocation_type: "specific_grants",
          revoked_grant_ids: grant_ids,
          revoked_count: revokedGrants?.length || 0,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          data: {
            document_id: documentId,
            revoked_grants: revokedGrants?.length || 0,
            message: `Revoked ${revokedGrants?.length || 0} access grant(s)`,
          },
        }),
        {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        }
      );
    }

    throw new ApiException("BAD_REQUEST", "Invalid action", 400);
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
