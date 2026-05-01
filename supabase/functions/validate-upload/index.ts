import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateMagicBytes } from "../_shared/magic-bytes.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";

/**
 * validate-upload - Server-side magic-byte validation for any uploaded file.
 *
 * Called AFTER a file has been stored in a bucket. Downloads the first 16 bytes,
 * runs magic-byte validation, and returns blocked/allowed verdict.
 *
 * POST body: { bucket, storage_path, client_mime, file_size }
 * Returns: { blocked: boolean, reason?: string, detected_mime?: string }
 */

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  const __pf = handleCorsPreflight(req);
  if (__pf) return __pf;

  const headers = { ...corsHeaders, "Content-Type": "application/json" };
  const wrap = (r: Response) => withCors(req, r);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ blocked: false, error: "No auth" }), { status: 401, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let authCtx: Awaited<ReturnType<typeof authenticateRequest>>;
    try {
      authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    } catch {
      return new Response(JSON.stringify({ blocked: false, error: "Unauthorised" }), { status: 401, headers });
    }
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { bucket, storage_path, client_mime, file_size } = body;

    if (!bucket || !storage_path) {
      return new Response(JSON.stringify({ blocked: false, error: "bucket and storage_path required" }), { status: 400, headers });
    }

    // Allowlist of buckets that may be validated through this endpoint.
    // Prevents authenticated users from probing arbitrary buckets via the
    // service-role admin client (which bypasses storage RLS).
    const ALLOWED_BUCKETS = ["match-documents", "kyc-documents", "governance-documents", "vault-documents"];
    if (!ALLOWED_BUCKETS.includes(bucket)) {
      return new Response(JSON.stringify({
        blocked: true,
        reason: "Invalid bucket",
      }), { status: 400, headers });
    }

    const filePath = storage_path.startsWith(bucket + "/") ? storage_path.slice(bucket.length + 1) : storage_path;

    if (bucket === "match-documents") {
      const [pathOrgId, pathMatchId] = filePath.split("/");
      if (!pathOrgId || !pathMatchId || pathOrgId !== authCtx.orgId) {
        return new Response(JSON.stringify({
          blocked: true,
          reason: "Caller does not have access to this file",
        }), { status: 403, headers });
      }

      const { data: match, error: matchError } = await admin
        .from("matches")
        .select("org_id, buyer_org_id, seller_org_id")
        .eq("id", pathMatchId)
        .single();
      const isPartyOrg = match && [match.org_id, match.buyer_org_id, match.seller_org_id].includes(authCtx.orgId);
      if (matchError || !isPartyOrg) {
        return new Response(JSON.stringify({
          blocked: true,
          reason: "Caller does not have access to this file",
        }), { status: 403, headers });
      }
    }

    // Download the file (just need first 16 bytes but storage SDK downloads all)
    const { data: fileData, error: dlError } = await admin.storage.from(bucket).download(filePath);

    if (dlError || !fileData) {
      // Fail-closed: cannot read file → report blocked
      return new Response(JSON.stringify({
        blocked: true,
        reason: "Could not verify file integrity - upload validation failed",
      }), { status: 200, headers });
    }

    const headerBytes = new Uint8Array(await fileData.slice(0, 16).arrayBuffer());
    const result = validateMagicBytes(headerBytes, client_mime || "application/octet-stream", file_size || 0);

    if (result.blocked) {
      // Audit the server-side rejection
      if (authCtx.orgId) {
        await admin.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: authCtx.userId,
          action: "document.upload_blocked",
          entity_type: "match_documents",
          entity_id: null,
          metadata: {
            bucket,
            storage_path,
            client_mime,
            detected_mime: result.detectedMime,
            reason: result.blockReason,
          },
        });
      }
    }

    return new Response(JSON.stringify({
      blocked: result.blocked,
      reason: result.blockReason || null,
      detected_mime: result.detectedMime || null,
      client_mime_match: result.clientMimeMatch,
    }), { status: 200, headers });

  } catch (err) {
    console.error("[validate-upload] Error:", err);
    return new Response(JSON.stringify({
      blocked: true,
      reason: "Server validation error",
    }), { status: 200, headers });
  }
});
