import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

/**
 * Document Review Endpoint - Upload Docs Spec §4.4
 *
 * Status transitions:
 *   uploaded → pending_review  (uploader or admin)
 *   pending_review → accepted  (admin/compliance only)
 *   pending_review → rejected  (admin/compliance only, requires reason)
 *   rejected → pending_review  (uploader can resubmit for review)
 *
 * PATCH /document-review/:documentId
 * Body:
 *   - action: "request_review" | "accept" | "reject"
 *   - reason: string (required for reject)
 *   - notes: string (optional verification notes)
 *
 * POST /document-review/:documentId/replace - Upload Docs Spec §4 Versioning
 *   Creates a new version of the document. Prior version becomes read-only.
 *   Body:
 *   - new_document_id: UUID of the already-uploaded replacement document
 */

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  request_review: { from: ["uploaded", "rejected"], to: "pending_review" },
  accept: { from: ["pending_review"], to: "accepted" },
  reject: { from: ["pending_review"], to: "rejected" },
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = { ...corsHeaders(allowedOrigins, origin), "Content-Type": "application/json" };

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "PATCH" && req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }
    assertIdempotencyKey(req);

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "document-review") parts.shift();

    const documentId = parts[0];
    const subAction = parts[1]; // e.g. "replace"

    if (!documentId || !uuidRegex.test(documentId)) {
      throw new ApiException("VALIDATION_ERROR", "Valid document ID is required", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const { actorUserId } = deriveActorIds(authCtx);
    const isAdmin = authCtx.roles.includes("platform_admin");

    // Fetch document
    const { data: doc, error: docErr } = await supabase
      .from("match_documents")
      .select("*")
      .eq("id", documentId)
      .single();

    if (docErr || !doc) {
      throw new ApiException("NOT_FOUND", "Document not found", 404);
    }

    const uploaderOrgId = doc.uploader_org_id || doc.org_id;
    const isUploader = uploaderOrgId === authCtx.orgId;

    // ── POST /document-review/:id/replace - Versioning ──
    if (req.method === "POST" && subAction === "replace") {
      if (!isUploader && !isAdmin) {
        throw new ApiException("FORBIDDEN", "Only the document uploader can replace a document", 403);
      }

      if (doc.status === "revoked" || doc.status === "archived") {
        throw new ApiException("STATE_CONFLICT", "Cannot replace a revoked or archived document", 422);
      }

      const body = await req.json();
      const newDocId = body.new_document_id;
      const changeNotes = body.change_notes || null;

      if (!newDocId || !uuidRegex.test(newDocId)) {
        throw new ApiException("VALIDATION_ERROR", "new_document_id (UUID) is required", 400);
      }

      // Circular-supersession prevention
      if (newDocId === documentId) {
        throw new ApiException("VALIDATION_ERROR", "A document cannot supersede itself", 400);
      }

      // Verify the new document exists, belongs to same match, and same org (IDOR prevention)
      const { data: newDoc, error: newDocErr } = await supabase
        .from("match_documents")
        .select("id, match_id, version, supersedes_document_id, root_document_id, uploader_org_id, org_id")
        .eq("id", newDocId)
        .single();

      if (newDocErr || !newDoc) {
        throw new ApiException("NOT_FOUND", "Replacement document not found", 404);
      }

      if (newDoc.match_id !== doc.match_id) {
        throw new ApiException("VALIDATION_ERROR", "Replacement document must belong to the same POI", 400);
      }

      // IDOR: new document must belong to the same org as the caller
      const newDocOrgId = newDoc.uploader_org_id || newDoc.org_id;
      if (!isAdmin && newDocOrgId !== authCtx.orgId) {
        throw new ApiException("FORBIDDEN", "You can only link documents uploaded by your organisation", 403);
      }

      // Prevent circular chains: new doc must not already be in this chain
      if (newDoc.supersedes_document_id) {
        throw new ApiException("STATE_CONFLICT", "Replacement document already supersedes another document", 422);
      }

      const newVersion = (doc.version || 1) + 1;
      const rootId = doc.root_document_id || doc.id;
      const nowIso = new Date().toISOString();

      // Mark old document as superseded (read-only, not current)
      const { data: archivedRows, error: archiveErr } = await supabase
        .from("match_documents")
        .update({
          status: "archived",
          is_current_version: false,
          superseded_at: nowIso,
        })
        .eq("id", documentId)
        .eq("is_current_version", true)
        .select("id");

      if (archiveErr) handleDatabaseError(archiveErr, requestId);
      if (!archivedRows || archivedRows.length === 0) {
        throw new ApiException("STATE_CONFLICT", "Document was already superseded by another version", 422);
      }

      // Update new document with version chain fields - verify with .select() for RLS truthfulness
      const { data: linkedRows, error: linkErr } = await supabase
        .from("match_documents")
        .update({
          version: newVersion,
          supersedes_document_id: documentId,
          root_document_id: rootId,
          is_current_version: true,
          change_notes: changeNotes,
        })
        .eq("id", newDocId)
        .select("id");

      if (linkErr) {
        // Rollback: restore old document as current since link failed
        console.error(`[${requestId}] Link step failed, rolling back archive`, linkErr);
        await supabase
          .from("match_documents")
          .update({ status: doc.status, is_current_version: true, superseded_at: null })
          .eq("id", documentId);
        handleDatabaseError(linkErr, requestId);
      }
      if (!linkedRows || linkedRows.length === 0) {
        // Rollback: link was silently blocked (e.g. RLS)
        console.error(`[${requestId}] Link step returned 0 rows, rolling back archive`);
        await supabase
          .from("match_documents")
          .update({ status: doc.status, is_current_version: true, superseded_at: null })
          .eq("id", documentId);
        throw new ApiException("STATE_CONFLICT", "Failed to link replacement document. The original has been restored.", 422);
      }

      // Audit
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        action: "document.replaced",
        entity_type: "match_document",
        entity_id: documentId,
        metadata: {
          old_document_id: documentId,
          new_document_id: newDocId,
          old_version: doc.version || 1,
          new_version: newVersion,
          root_document_id: rootId,
          match_id: doc.match_id,
          change_notes: changeNotes,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        data: {
          old_document_id: documentId,
          new_document_id: newDocId,
          old_version: doc.version || 1,
          new_version: newVersion,
          root_document_id: rootId,
          message: `Document replaced. Version ${doc.version || 1} is now archived (read-only). Version ${newVersion} is active.`,
        },
      }), { status: 200, headers });
    }

    // ── PATCH /document-review/:id - Status transitions ──
    const body = await req.json();
    const { action, reason, notes: verificationNotes } = body;

    if (!action || !["request_review", "accept", "reject"].includes(action)) {
      throw new ApiException("VALIDATION_ERROR", "action must be one of: request_review, accept, reject", 400);
    }

    if (action === "reject" && !reason) {
      throw new ApiException("VALIDATION_ERROR", "reason is required when rejecting a document", 400);
    }

    // Permission check: accept/reject require admin
    if ((action === "accept" || action === "reject") && !isAdmin) {
      throw new ApiException("FORBIDDEN", "Only admin/compliance officers can accept or reject documents", 403);
    }

    // request_review can be done by uploader or admin
    if (action === "request_review" && !isUploader && !isAdmin) {
      throw new ApiException("FORBIDDEN", "Only the document uploader can request review", 403);
    }

    // Validate state transition
    const transition = VALID_TRANSITIONS[action];
    const allowedFromStates = transition.from as unknown as string[];
    const targetState = transition.to as unknown as string;

    if (!allowedFromStates.includes(doc.status)) {
      throw new ApiException(
        "STATE_CONFLICT",
        `Cannot ${action} a document with status "${doc.status}". Allowed from: ${allowedFromStates.join(", ")}`,
        422
      );
    }

    // Apply update
    const updateData: Record<string, unknown> = {
      status: targetState,
    };

    if (action === "accept") {
      updateData.verified_at = new Date().toISOString();
      updateData.verified_by = actorUserId;
      updateData.verification_notes = verificationNotes || null;
    }

    if (action === "reject") {
      updateData.verification_notes = reason;
      updateData.verified_by = actorUserId;
    }

    const { error: updateErr } = await supabase
      .from("match_documents")
      .update(updateData)
      .eq("id", documentId);

    if (updateErr) handleDatabaseError(updateErr, requestId);

    // Audit log
    await supabase.from("audit_logs").insert({
      org_id: authCtx.orgId,
      actor_user_id: actorUserId,
      action: `document.${action}`,
      entity_type: "match_document",
      entity_id: documentId,
      metadata: {
        match_id: doc.match_id,
        previous_status: doc.status,
        new_status: targetState,
        reason: reason || null,
        notes: verificationNotes || null,
        filename: doc.filename,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      data: {
        document_id: documentId,
        previous_status: doc.status,
        new_status: targetState,
        action,
        message: action === "accept"
          ? "Document accepted and verified"
          : action === "reject"
          ? `Document rejected: ${reason}`
          : "Document submitted for review",
      },
    }), { status: 200, headers });
  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
