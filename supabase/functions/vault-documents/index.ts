import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { validateMagicBytes } from "../_shared/magic-bytes.ts";

/**
 * DISC-004 Supporting Collateral Documentation
 *
 * POST: Upload metadata for vault document (actual file via storage)
 * GET:  List vault documents for an entity
 *
 * Accepted document types:
 *   refinery_licence, export_permit, production_permit,
 *   trade_reference, shipping_record, other
 *
 * Events: intel.supporting_collateral.uploaded
 */

const VALID_DOC_TYPES = [
  "refinery_licence", "export_permit", "production_permit",
  "trade_reference", "shipping_record", "other",
];

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || '');
  if (corsResp) return corsResp;

  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
  const headers = { ...corsHeaders(Deno.env.get("ALLOWED_ORIGINS") || '', req.headers.get("origin")), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const { actorUserId } = deriveActorIds(authCtx);
    const admin = createClient(supabaseUrl, serviceKey);

    // ── GET: List vault documents ──
    if (req.method === "GET") {
      const url = new URL(req.url);
      const entityId = url.searchParams.get("entity_id");
      if (!entityId) throw new ApiException("VALIDATION_ERROR", "entity_id required", 400);

      const { data, error } = await admin
        .from("vault_documents")
        .select("*")
        .eq("entity_id", entityId)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false });

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify({
        status: "SUCCESS",
        correlation_id: correlationId,
        data: data || [],
      }), { headers });
    }

    // ── POST: Register vault document ──
    if (req.method === "POST") {
      const body = await req.json();
      const { entity_id, document_type, file_name, storage_path, file_size, mime_type, metadata } = body;

      if (!entity_id || !document_type || !file_name || !storage_path) {
        throw new ApiException("VALIDATION_ERROR", "entity_id, document_type, file_name, and storage_path are required", 400);
      }

      if (!VALID_DOC_TYPES.includes(document_type)) {
        throw new ApiException("VALIDATION_ERROR", `Invalid document_type. Must be one of: ${VALID_DOC_TYPES.join(", ")}`, 400);
      }

      // Verify entity
      const { data: entity } = await admin
        .from("entities")
        .select("id")
        .eq("id", entity_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);

      // ── Server-side magic-byte validation ──
      // Read the first 16 bytes from storage to verify the file is what it claims to be
      if (storage_path) {
        const bucket = storage_path.startsWith("vault-documents") ? "vault-documents" : storage_path.split("/")[0] || "vault-documents";
        const filePath = storage_path.startsWith(bucket + "/") ? storage_path.slice(bucket.length + 1) : storage_path;
        const { data: fileData, error: dlError } = await admin.storage.from(bucket).download(filePath);
        if (!dlError && fileData) {
          const headerBytes = new Uint8Array(await fileData.slice(0, 16).arrayBuffer());
          const result = validateMagicBytes(headerBytes, mime_type || "application/octet-stream", file_size || 0);
          if (result.blocked) {
            throw new ApiException("VALIDATION_ERROR", result.blockReason || "File type not allowed", 400);
          }
          if (result.detectedMime && !result.clientMimeMatch) {
            console.warn(`[vault-documents] MIME mismatch: client=${mime_type}, detected=${result.detectedMime}`);
          }
        }
      }

      const { data: doc, error: insertErr } = await admin
        .from("vault_documents")
        .insert({
          entity_id,
          org_id: orgId,
          document_type,
          file_name,
          storage_path,
          file_size: file_size || null,
          mime_type: mime_type || null,
          uploaded_by: actorUserId || null,
          metadata: metadata || {},
        })
        .select()
        .single();

      if (insertErr) throw new ApiException("INTERNAL_ERROR", insertErr.message, 500);

      // Emit event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "intel",
        aggregate_type: "collateral",
        aggregate_id: doc.id,
        event_type: "intel.supporting_collateral.uploaded",
        actor_id: actorUserId || null,
        payload: { entity_id, document_type, file_name },
        event_hash: await computeHash(JSON.stringify({ doc_id: doc.id })),
      });

      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: actorUserId || null,
        action: "intel.collateral.uploaded",
        entity_type: "vault_document",
        entity_id: doc.id,
        metadata: { entity_id, document_type },
      });

      return new Response(JSON.stringify({
        status: "SUCCESS",
        correlation_id: correlationId,
        data: doc,
      }), { status: 201, headers });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof ApiException) {
      return new Response(JSON.stringify({
        status: "ERROR", correlation_id: correlationId,
        error: { code: err.code, message: err.message },
      }), { status: err.statusCode, headers });
    }
    console.error("vault-documents error:", err);
    return new Response(JSON.stringify({
      status: "ERROR", correlation_id: correlationId,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    }), { status: 500, headers });
  }
});
