import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { validateMagicBytes } from "../_shared/magic-bytes.ts";

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
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const headers = { ...corsHeaders, "Content-Type": "application/json" };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ blocked: false, error: "No auth" }), { status: 401, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller is authenticated
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ blocked: false, error: "Unauthorised" }), { status: 401, headers });
    }

    const body = await req.json();
    const { bucket, storage_path, client_mime, file_size } = body;

    if (!bucket || !storage_path) {
      return new Response(JSON.stringify({ blocked: false, error: "bucket and storage_path required" }), { status: 400, headers });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Download the file (just need first 16 bytes but storage SDK downloads all)
    const filePath = storage_path.startsWith(bucket + "/") ? storage_path.slice(bucket.length + 1) : storage_path;
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
      const { data: profile } = await admin.from("profiles").select("org_id").eq("id", user.id).single();
      if (profile?.org_id) {
        await admin.from("audit_logs").insert({
          org_id: profile.org_id,
          actor_user_id: user.id,
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
        }).catch(() => {});
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
