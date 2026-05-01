// One-shot: copies __NEW_INTERNAL_CRON_KEY into vault.secrets as INTERNAL_CRON_KEY
// Returns only safe fingerprints (length + sha256 prefix). Never returns the value.
// Delete this function after use.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha8(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 4).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const adminKey = req.headers.get("x-bootstrap-admin");
    const expected = Deno.env.get("LOVABLE_BOOTSTRAP_ADMIN_KEY") || Deno.env.get("INTERNAL_CRON_KEY");
    if (!adminKey || adminKey !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const newVal = Deno.env.get("__NEW_INTERNAL_CRON_KEY");
    const edgeVal = Deno.env.get("INTERNAL_CRON_KEY");
    if (!newVal) {
      return new Response(JSON.stringify({ error: "__NEW_INTERNAL_CRON_KEY not set" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Upsert into vault via RPC wrapper
    const { error: upsertErr } = await sb.rpc("vault_upsert_internal_cron_key", { p_value: newVal });
    if (upsertErr) {
      return new Response(JSON.stringify({ error: "vault upsert failed", detail: upsertErr.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read back from vault for fingerprint
    const { data: vaultRow, error: readErr } = await sb
      .from("vault.decrypted_secrets" as any)
      .select("decrypted_secret")
      .eq("name", "INTERNAL_CRON_KEY")
      .maybeSingle();

    let vaultLen = 0, vaultSha = "missing";
    if (!readErr && vaultRow?.decrypted_secret) {
      vaultLen = (vaultRow.decrypted_secret as string).length;
      vaultSha = await sha8(vaultRow.decrypted_secret as string);
    } else {
      // fallback via SQL function
      const { data: rpcRead } = await sb.rpc("vault_read_internal_cron_key_fingerprint");
      if (rpcRead && Array.isArray(rpcRead) && rpcRead[0]) {
        vaultLen = rpcRead[0].len ?? 0;
        vaultSha = rpcRead[0].sha8 ?? "missing";
      }
    }

    const result = {
      edge_present: !!edgeVal,
      edge_len: edgeVal?.length ?? 0,
      edge_sha8: edgeVal ? await sha8(edgeVal) : "missing",
      new_present: true,
      new_len: newVal.length,
      new_sha8: await sha8(newVal),
      vault_len: vaultLen,
      vault_sha8: vaultSha,
      match_edge_vault: edgeVal ? (await sha8(edgeVal)) === vaultSha && edgeVal.length === vaultLen : false,
      match_new_vault: (await sha8(newVal)) === vaultSha && newVal.length === vaultLen,
    };

    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
