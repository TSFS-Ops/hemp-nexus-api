// Batch D — HQ governance waiver/bypass grant + renew edge function.
//
// Access:
//   - platform_admin only (RBAC via is_admin RPC).
//   - AAL2/MFA required (assertAal2).
//   - Service-role insert via shared helper grantGovernanceWaiver /
//     renewGovernanceWaiver (the only supported path; RLS forbids
//     authenticated INSERTs).
//
// Body: see handler.ts WaiverBodySchema.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { assertAal2 } from "../_shared/aal.ts";
import { ApiException } from "../_shared/errors.ts";
import {
import { corsHeaders as __buildCorsHeaders, handleCors as __handleCors } from "../_shared/cors.ts";
  grantGovernanceWaiver,
  renewGovernanceWaiver,
} from "../_shared/governance-waivers.ts";
import { parseWaiverBody } from "./handler.ts";

Deno.serve(async (req) => {
  const corsHeaders = __buildCorsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "", req.headers.get("origin"));
  const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

  const __pf = __handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "");
  if (__pf) return __pf;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: u, error: uerr } = await userClient.auth.getUser();
  if (uerr || !u?.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin } = await admin.rpc("is_admin", { user_id: u.user.id });
  if (!isAdmin) return json({ error: "forbidden", code: "NOT_PLATFORM_ADMIN" }, 403);

  try {
    await assertAal2(authHeader, {
      adminClient: admin,
      callerUserId: u.user.id,
      action: "governance-waiver-grant",
    });
  } catch (e) {
    if (e instanceof ApiException && e.code === "MFA_REQUIRED") {
      return json({ error: "mfa_required", code: "MFA_REQUIRED" }, 403);
    }
    return json({ error: "aal_check_failed" }, 500);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid_json", code: "INVALID_JSON" }, 400);
  }
  const parsed = parseWaiverBody(raw);
  if (!parsed.ok) {
    return json(
      { error: parsed.message, code: parsed.code, details: parsed.details },
      parsed.status,
    );
  }
  const body = parsed.body;
  const requestId = req.headers.get("x-request-id");

  try {
    if (body.mode === "grant") {
      const row = await grantGovernanceWaiver(admin, {
        org_id: body.org_id,
        posture: body.posture,
        scope: body.scope,
        scope_id: body.scope_id ?? null,
        match_id: body.match_id ?? null,
        poi_id: body.poi_id ?? null,
        wad_id: body.wad_id ?? null,
        granted_by: u.user.id,
        reason_code: body.reason_code,
        note: body.note ?? null,
        expires_at: body.expires_at ?? null,
        max_uses: body.max_uses,
        request_id: requestId,
      });
      return json({ ok: true, waiver: row }, 200);
    }
    const row = await renewGovernanceWaiver(admin, {
      prior_waiver_id: body.prior_waiver_id,
      granted_by: u.user.id,
      reason_code: body.reason_code,
      note: body.note ?? null,
      expires_at: body.expires_at ?? null,
      max_uses: body.max_uses,
      request_id: requestId,
    });
    return json({ ok: true, waiver: row }, 200);
  } catch (e) {
    console.error("[governance-waiver-grant] CRITICAL:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return json(
      { error: "waiver_write_failed", code: "WAIVER_WRITE_FAILED", detail: msg },
      500,
    );
  }
});
