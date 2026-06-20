/**
 * P010 — Stub Provider Test-Mode Simulation (admin/dev only, audit-only).
 *
 * Hardened endpoint that admins/developers can call to record a stub-provider
 * "simulation". It NEVER calls a real external provider and NEVER writes to
 * verification, screening, KYC/KYB, POI, WaD, match, token, or notification
 * state.
 *
 * Gates (all must pass):
 *   1. Valid JWT.
 *   2. Caller has `platform_admin` OR `developer` role.
 *   3. `admin_settings.test_mode_bypass.enabled === true` (Test Mode active).
 *
 * Outcomes:
 *   - Gate 1 fail → 401.
 *   - Gate 2 fail → 403 + audit `stub_provider.blocked` (reason=not_admin).
 *   - Gate 3 fail → 200 with `buildStubProviderNotLiveEnvelope(...)` +
 *                   audit `stub_provider.blocked` (reason=test_mode_off).
 *   - All pass   → 200 with `buildStubProviderTestModeSimulationEnvelope(...)` +
 *                   audit `stub_provider.test_mode_simulated`.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  buildStubProviderNotLiveEnvelope,
  buildStubProviderTestModeSimulationEnvelope,
  isStubProvider,
  STUB_PROVIDER_AUDIT,
  STUB_PROVIDER_ERROR_CODE,
  STUB_PROVIDER_LABEL_LONG,
  STUB_PROVIDER_STATUS,
} from "../_shared/stub-providers.ts";

interface SimulateBody {
  provider?: string;
  org_id?: string | null;
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function writeAudit(
  serviceClient: ReturnType<typeof createClient>,
  action: string,
  payload: Record<string, unknown>,
) {
  try {
    await serviceClient.from("admin_audit_logs").insert({
      action,
      payload,
      actor_user_id: payload.user_id ?? null,
      org_id: payload.organisation_id ?? null,
    });
  } catch (_e) {
    // Audit write must never break the gate.
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "METHOD_NOT_ALLOWED" });
  }

  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // --- Gate 1: JWT ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse(401, { error: "UNAUTHORIZED", requestId });
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResponse(401, { error: "UNAUTHORIZED", requestId });
  }
  const user = userData.user;

  // --- Parse body ---
  let body: SimulateBody = {};
  try {
    body = (await req.json()) as SimulateBody;
  } catch {
    return jsonResponse(400, { error: "INVALID_JSON", requestId });
  }
  const provider = (body.provider ?? "").toString().toLowerCase().trim();
  if (!isStubProvider(provider)) {
    return jsonResponse(400, {
      error: "INVALID_PROVIDER",
      message: "Provider must be one of the four declared stub providers.",
      requestId,
    });
  }

  const serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- Gate 2: role ---
  const [adminRole, devRole] = await Promise.all([
    serviceClient.rpc("has_role", { _user_id: user.id, _role: "platform_admin" }),
    serviceClient.rpc("has_role", { _user_id: user.id, _role: "developer" }),
  ]);
  const isAdmin = adminRole.data === true || devRole.data === true;
  const role = adminRole.data === true ? "platform_admin" : devRole.data === true ? "developer" : null;

  if (!isAdmin) {
    await writeAudit(serviceClient, STUB_PROVIDER_AUDIT.BLOCKED, {
      user_id: user.id,
      role: null,
      organisation_id: body.org_id ?? null,
      provider_category: provider,
      provider_id: provider,
      action_attempted: "stub_provider_simulate",
      test_mode_active: false,
      timestamp: new Date().toISOString(),
      outcome: "blocked_not_admin",
      reason: STUB_PROVIDER_LABEL_LONG,
      request_id: requestId,
    });
    return jsonResponse(403, {
      ok: false,
      error: "FORBIDDEN",
      status: STUB_PROVIDER_STATUS.STUB_NOT_LIVE,
      message: STUB_PROVIDER_LABEL_LONG,
      requestId,
    });
  }

  // --- Gate 3: Test Mode active ---
  let testModeActive = false;
  try {
    const { data } = await serviceClient
      .from("admin_settings")
      .select("value")
      .eq("key", "test_mode_bypass")
      .maybeSingle();
    const v = (data?.value ?? {}) as Record<string, unknown>;
    testModeActive = v.enabled === true;
  } catch {
    testModeActive = false;
  }

  if (!testModeActive) {
    await writeAudit(serviceClient, STUB_PROVIDER_AUDIT.BLOCKED, {
      user_id: user.id,
      role,
      organisation_id: body.org_id ?? null,
      provider_category: provider,
      provider_id: provider,
      action_attempted: "stub_provider_simulate",
      test_mode_active: false,
      timestamp: new Date().toISOString(),
      outcome: "blocked_test_mode_off",
      reason: STUB_PROVIDER_LABEL_LONG,
      request_id: requestId,
    });
    const env = buildStubProviderNotLiveEnvelope(provider, requestId);
    return jsonResponse(200, { ...env, error: STUB_PROVIDER_ERROR_CODE });
  }

  // --- All gates pass: audit-only simulation ---
  await writeAudit(serviceClient, STUB_PROVIDER_AUDIT.TEST_MODE_SIMULATED, {
    user_id: user.id,
    role,
    organisation_id: body.org_id ?? null,
    provider_category: provider,
    provider_id: provider,
    action_attempted: "stub_provider_simulate",
    test_mode_active: true,
    timestamp: new Date().toISOString(),
    outcome: "test_mode_bypass",
    reason: STUB_PROVIDER_LABEL_LONG,
    external_provider_called: false,
    request_id: requestId,
  });

  return jsonResponse(200, buildStubProviderTestModeSimulationEnvelope(provider, requestId));
});
