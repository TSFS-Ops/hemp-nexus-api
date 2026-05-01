/**
 * _diag-cron-key-fingerprint
 * Temporary, read-only diagnostic for INTERNAL_CRON_KEY reconciliation.
 * Returns ONLY safe fingerprints — never the raw secret.
 * Auth: requires header `x-diag-token` matching SUPABASE_SERVICE_ROLE_KEY's first 16 chars.
 * Designed to be deleted immediately after the reconciliation audit.
 */
import { webhookCorsHeaders } from "../_shared/cors.ts";

const corsHeaders = { ...webhookCorsHeaders() };

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Coarse auth: require the caller to know the first 16 chars of the service role key.
  // Service role key is not user-bound and is only known to operators with DB access.
  const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expected = srk.slice(0, 16);
  const provided = req.headers.get("x-diag-token") ?? "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const exists = secret.length > 0;
  const length = exists ? secret.length : 0;
  const sha256_prefix = exists ? (await sha256Hex(secret)).slice(0, 8) : "";

  return new Response(
    JSON.stringify({ source: "edge_env", exists, length, sha256_prefix }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
