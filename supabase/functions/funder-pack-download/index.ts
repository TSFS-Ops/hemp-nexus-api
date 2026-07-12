/**
 * Institutional Funder Evidence Workspace — Batch 4
 * funder-pack-download
 *
 * POST body: { pack_version_id: string }
 * Auth: caller must be an approved funder user whose org owns the release
 * and whose release has can_download_compiled_pack = true (enforced by
 * fw_funder_authorize_pack_download_v1). RPC also records audit + usage.
 *
 * Returns a short-lived signed URL to the private storage object. No
 * public URLs are ever issued.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SIGNED_URL_TTL_SECONDS = 600; // 10 minutes

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const packVersionId = String(body?.pack_version_id ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(packVersionId)) {
      return json({ error: "invalid_pack_version_id" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const { data: authRes, error: authErr } = await userClient.rpc(
      "fw_funder_authorize_pack_download_v1",
      { p_pack_version_id: packVersionId },
    );
    if (authErr) {
      // Do not leak internal reasons to funders.
      return json({ error: "not_available" }, 403);
    }

    const info = authRes as {
      storage_bucket: string;
      storage_path: string;
      version: number;
      file_sha256: string;
    };

    const { data: signed, error: signErr } = await admin.storage
      .from(info.storage_bucket)
      .createSignedUrl(info.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) {
      return json({ error: "signed_url_failed" }, 500);
    }

    return json({
      ok: true,
      signed_url: signed.signedUrl,
      expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      version: info.version,
      file_sha256: info.file_sha256,
    }, 200);
  } catch (e) {
    return json({ error: "unhandled", detail: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
