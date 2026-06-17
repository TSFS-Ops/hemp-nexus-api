// UAT-only password reset for two seeded test accounts.
// Scope-locked allowlist. Audits to audit_logs. No real client accounts touched.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ALLOWLIST = new Set([
  "api@izenzo.co.za",
  "test1@izenzo.co.za",
]);

function genPassword() {
  const rand = crypto.getRandomValues(new Uint8Array(12));
  const b64 = btoa(String.fromCharCode(...rand)).replace(/[+/=]/g, "");
  return `UAT-AILI-${b64}!9`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = Deno.env.get("SUPABASE_URL")!;
  const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, srv, { auth: { persistSession: false } });

  try {
    const body = await req.json().catch(() => ({}));
    const guard = body?.uat_guard;
    if (guard !== "AI_LIGHT_INTEL_V1_UAT_ACCESS_SETUP") {
      return new Response(JSON.stringify({ error: "guard_required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown>[] = [];

    const TARGETS: Array<{ email: string; user_id: string }> = [
      { email: "api@izenzo.co.za",  user_id: "a9398f73-1bc0-4943-abfe-1bb5763cb18d" },
      { email: "test1@izenzo.co.za", user_id: "f07073dc-4a43-4803-9fb6-7ef7579ae332" },
    ];

    for (const t of TARGETS) {
      const email = t.email;
      if (!ALLOWLIST.has(email)) {
        results.push({ email, status: "FAIL", reason: "not_in_allowlist" });
        continue;
      }
      const { data: got, error: gErr } = await admin.auth.admin.getUserById(t.user_id);
      if (gErr || !got?.user) {
        results.push({ email, status: "FAIL", reason: gErr?.message || "user_not_found" });
        continue;
      }
      const user = got.user;
      if (user.deleted_at || (user as any).banned_until) {
        results.push({ email, status: "FAIL", reason: "user_disabled_or_deleted" });
        continue;
      }
      const password = genPassword();
      const { error: uErr } = await admin.auth.admin.updateUserById(user.id, {
        password,
        email_confirm: true,
      });
      if (uErr) {
        results.push({ email, status: "FAIL", reason: uErr.message });
        continue;
      }

      // Live login probe with anon key
      const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
      const loginResp = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anon },
        body: JSON.stringify({ email, password }),
      });
      const loginOk = loginResp.ok;
      const loginBody = await loginResp.json().catch(() => ({}));

      await admin.from("audit_logs").insert({
        action: "uat.password_reset",
        entity_type: "auth_user",
        entity_id: user.id,
        actor_id: user.id,
        metadata: {
          email,
          purpose: "AI_LIGHT_INTEL_V1_UAT_ACCESS_SETUP",
          login_probe_ok: loginOk,
        },
      });

      results.push({
        email,
        user_id: user.id,
        status: "PASS",
        password,
        login_probe: loginOk ? "PASS" : "FAIL",
        login_probe_detail: loginOk ? { has_access_token: !!loginBody?.access_token } : loginBody,
      });
    }

    return new Response(JSON.stringify({ ok: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
