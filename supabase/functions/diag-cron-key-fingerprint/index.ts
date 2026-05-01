/**
 * diag-cron-key-fingerprint (TEMPORARY)
 * Returns ONLY safe fingerprints for INTERNAL_CRON_KEY env var.
 * Never returns raw secret. Will be deleted immediately after audit.
 */
import { webhookCorsHeaders } from "../_shared/cors.ts";
const corsHeaders = { ...webhookCorsHeaders() };

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const secret = Deno.env.get("INTERNAL_CRON_KEY") ?? "";
  const exists = secret.length > 0;
  return new Response(JSON.stringify({
    source: "edge_env",
    exists,
    length: exists ? secret.length : 0,
    sha256_prefix: exists ? (await sha256Hex(secret)).slice(0, 8) : "",
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
