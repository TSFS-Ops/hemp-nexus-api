import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";

const BodySchema = z.object({
  match_id: z.string().uuid(),
  document_id: z.string().uuid(),
  storage_path: z.string().min(1).max(1200),
  filename: z.string().min(1).max(500),
  file_size: z.number().int().nonnegative().nullable().optional(),
  mime_type: z.string().max(255).nullable().optional(),
  sha256_hash: z.string().min(16).max(256),
  doc_type: z.string().min(1).max(100).default("other"),
  title: z.string().max(500).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  visibility: z.enum(["private", "share_with_counterparty", "share_with_roles"]).default("private"),
  magic_bytes_verified: z.boolean().nullable().optional(),
  server_detected_mime: z.string().max(255).nullable().optional(),
  client_request_id: z.string().uuid().optional(),
});

type Body = z.infer<typeof BodySchema>;

function clip(value: unknown, max = 2000): string | null {
  if (value === null || value === undefined) return null;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);
  let body: Body | null = null;
  let auditOrgId: string | null = null;
  let actorUserId: string | null = null;
  let actorApiKeyId: string | null = null;
  let auditBase: Record<string, unknown> = { server_request_id: requestId };

  async function writeAudit(phase: string, outcome: "success" | "failure", extra: Record<string, unknown> = {}) {
    const metadata = { ...auditBase, phase, outcome, ...extra };
    console.log(JSON.stringify({ tag: "finalise-match-document-upload", ...metadata }));
    if (!auditOrgId) return;
    const { error } = await admin.from("audit_logs").insert({
      org_id: auditOrgId,
      actor_user_id: actorUserId,
      actor_api_key_id: actorApiKeyId,
      action: "document.upload.attempt",
      entity_type: "match_document",
      entity_id: body?.match_id ?? null,
      metadata,
    });
    if (error) console.error(JSON.stringify({ tag: "finalise-match-document-upload.audit_failed", requestId, error: error.message }));
  }

  async function cleanup(reason: string) {
    if (!body?.storage_path) return { cleanup_attempted: false, cleanup_succeeded: false, cleanup_error: null };
    const { error } = await admin.storage.from("match-documents").remove([body.storage_path]);
    const result = { cleanup_attempted: true, cleanup_succeeded: !error, cleanup_error: error?.message ?? null };
    await writeAudit(error ? "orphan_cleanup" : "cleanup", error ? "failure" : "success", { reason, ...result });
    return result;
  }

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;
    if (req.method !== "POST") throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const ids = deriveActorIds(authCtx);
    actorUserId = ids.actorUserId;
    actorApiKeyId = ids.actorApiKeyId;
    if (authCtx.isApiKey) throw new ApiException("FORBIDDEN", "Only signed-in users can attach match documents", 403);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiException("VALIDATION_ERROR", "Invalid upload finalisation payload", 400, parsed.error.flatten().fieldErrors);
    body = parsed.data;
    auditOrgId = authCtx.orgId || null;
    auditBase = {
      server_request_id: requestId,
      client_request_id: body.client_request_id ?? null,
      user_id: actorUserId,
      profile_org_id: authCtx.orgId,
      match_id: body.match_id,
      document_id: body.document_id,
      storage_path: body.storage_path,
      filename: body.filename,
      file_size: body.file_size ?? null,
      mime_type: body.mime_type ?? null,
    };

    const { data: match, error: matchError } = await admin
      .from("matches")
      .select("id, org_id, buyer_org_id, seller_org_id")
      .eq("id", body.match_id)
      .maybeSingle();
    if (matchError || !match) {
      const cleanupResult = await cleanup("match_lookup_failed");
      await writeAudit("finalise", "failure", { error_code: "MATCH_NOT_FOUND", error_message: clip(matchError?.message ?? "Match not found"), ...cleanupResult });
      throw new ApiException("NOT_FOUND", "Match not found", 404);
    }

    const participantRoles = [
      match.org_id === authCtx.orgId ? "initiator" : null,
      match.buyer_org_id === authCtx.orgId ? "buyer" : null,
      match.seller_org_id === authCtx.orgId ? "seller" : null,
    ].filter(Boolean);
    const isParticipant = participantRoles.length > 0;
    const isPlatformAdmin = (authCtx.roles ?? []).includes("platform_admin");
    auditOrgId = authCtx.orgId || match.org_id || match.buyer_org_id || match.seller_org_id;
    auditBase = { ...auditBase, match_org_id: match.org_id, match_buyer_org_id: match.buyer_org_id, match_seller_org_id: match.seller_org_id, participant_roles: participantRoles, participant_check_result: isParticipant || isPlatformAdmin ? "allow" : "deny", is_platform_admin: isPlatformAdmin };

    if (!isParticipant && !isPlatformAdmin) {
      const cleanupResult = await cleanup("non_participant_finalisation_blocked");
      await writeAudit("finalise", "failure", { error_code: "ORG_NOT_PARTICIPANT", error_message: "Your organisation is not a participant on this match, so this document cannot be attached.", ...cleanupResult });
      throw new ApiException("ORG_NOT_PARTICIPANT", "Your organisation is not a participant on this match, so this document cannot be attached.", 403);
    }

    const [pathOrgId, pathMatchId, pathKind, pathDocId] = body.storage_path.split("/");
    if (pathOrgId !== authCtx.orgId || pathMatchId !== body.match_id || pathKind !== "poi" || pathDocId !== body.document_id) {
      const cleanupResult = await cleanup("storage_path_scope_mismatch");
      await writeAudit("finalise", "failure", { error_code: "STORAGE_PATH_SCOPE_MISMATCH", error_message: "Storage path does not belong to this organisation and match", ...cleanupResult });
      throw new ApiException("STORAGE_PATH_SCOPE_MISMATCH", "Storage path does not belong to this organisation and match", 400);
    }

    const { data: objectRows, error: objectError } = await admin
      .schema("storage")
      .from("objects")
      .select("id, bucket_id, name, owner_id, created_at, metadata")
      .eq("bucket_id", "match-documents")
      .eq("name", body.storage_path)
      .limit(1);
    const storageObject = objectRows?.[0] ?? null;
    if (objectError || !storageObject) {
      await writeAudit("finalise", "failure", { error_code: "STORAGE_OBJECT_MISSING", error_message: clip(objectError?.message ?? "Storage object missing"), storage_object_exists: false });
      throw new ApiException("STORAGE_OBJECT_MISSING", "Upload could not be completed because the stored file could not be verified.", 409);
    }

    const { data: doc, error: insertError } = await admin
      .from("match_documents")
      .insert({
        id: body.document_id,
        match_id: body.match_id,
        org_id: authCtx.orgId,
        uploader_user_id: authCtx.userId,
        uploader_org_id: authCtx.orgId,
        doc_type: body.doc_type || "other",
        filename: body.filename,
        storage_path: body.storage_path,
        sha256_hash: body.sha256_hash,
        file_size: body.file_size ?? null,
        mime_type: body.mime_type ?? null,
        magic_bytes_verified: body.magic_bytes_verified ?? false,
        server_detected_mime: body.server_detected_mime ?? null,
        status: "uploaded",
        title: body.title ?? null,
        notes: body.notes ?? null,
        visibility: body.visibility,
        root_document_id: body.document_id,
        version: 1,
        is_current_version: true,
      })
      .select("id, match_id, storage_path, uploader_org_id, created_at")
      .single();

    if (insertError || !doc) {
      const cleanupResult = await cleanup("match_documents_insert_failed");
      await writeAudit("db_insert", "failure", { db_insert_result: "failure", error_code: insertError?.code ?? "DB_INSERT_FAILED", error_message: clip(insertError?.message ?? "DB insert failed"), storage_object_exists: true, ...cleanupResult });
      throw new ApiException("DB_INSERT_FAILED", "The file was uploaded but could not be attached to this match. The stored file was cleaned up or logged for reconciliation.", 500);
    }

    await writeAudit("finalise", "success", { db_insert_result: "success", storage_object_exists: true, document_row_exists: true, document_row_id: doc.id, cleanup_attempted: false });

    return new Response(JSON.stringify({ ok: true, request_id: requestId, document: doc }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    return errorResponse(err as Error, requestId, headers);
  }
});
