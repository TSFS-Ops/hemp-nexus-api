/**
 * GET /debug-flags
 *
 * Protected diagnostic endpoint that returns the platform's current
 * maintenance / test-mode flags and the most relevant adjacent config so
 * support can answer "why is action X being blocked for user Y?" from a
 * single screenshot or log line — without spelunking the database.
 *
 * Access control:
 *   - Requires a valid JWT.
 *   - Caller must hold the `platform_admin` role (RBAC Stage 1/2:
 *     legacy `admin` is deprecated and no longer accepted here).
 *   - Anything else → 403 FORBIDDEN.
 *
 * Response shape (stable; safe to share in tickets):
 *   {
 *     requestId,
 *     timestamp,
 *     caller: { userId, email, roles, isPlatformAdmin },
 *     maintenance: { enabled, raw },
 *     testMode: {
 *       masterEnabled,
 *       gates: { idv, sanctions, kyb, ubo, authority },
 *       note,
 *       raw,
 *     },
 *     outreachSla: { ... },
 *     environment: {
 *       hasResendKey, hasLovableApiKey, supabaseUrl,
 *       allowedOriginsConfigured,
 *     },
 *     edgeRuntime: { denoVersion, region }
 *   }
 *
 * NEVER returns secret values — only presence booleans.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { logDecision } from "../_shared/test-mode-bypass.ts";

const TEST_MODE_GATES = ["idv", "sanctions", "kyb", "ubo", "authority"] as const;

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "GET") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Only GET is supported", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient: any = createClient(supabaseUrl, serviceKey);

    // ── AuthN ─────────────────────────────────────────────────────────────
    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const callerId = authCtx.userId;
    const callerEmail = (authCtx as { email?: string }).email ?? null;

    // ── AuthZ: must be platform_admin (RBAC Stage 1/2 — legacy admin removed)
    const { data: roleRows, error: rolesErr } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId);

    if (rolesErr) {
      throw new ApiException("INTERNAL_ERROR", `roles_lookup_failed: ${rolesErr.message}`, 500);
    }

    const roles = (roleRows ?? []).map((r: { role: string }) => r.role);
    const isPlatformAdmin = roles.includes("platform_admin");
    // Tightened: only platform-wide admin roles. `org_admin` is org-scoped
    // and must NOT see platform-wide flags. Legacy 'admin' role is deprecated
    // (RBAC Stage 1/2) — `platform_admin` is now the only canonical super-admin.

    if (!isPlatformAdmin) {
      logDecision("maintenance", {
        source: "debug-flags",
        decision: "block",
        requestId,
        actorUserId: callerId,
        reason: "forbidden_non_admin",
      });
      throw new ApiException(
        "FORBIDDEN",
        "debug-flags requires the platform_admin role",
        403,
      );
    }

    // ── Pull every relevant admin_settings row in one round-trip ──────────
    const settingsKeys = ["general", "test_mode_bypass", "outreach_sla"];
    const { data: settingsRows, error: settingsErr } = await adminClient
      .from("admin_settings")
      .select("key, value, updated_at")
      .in("key", settingsKeys);

    if (settingsErr) {
      throw new ApiException("INTERNAL_ERROR", `settings_read_failed: ${settingsErr.message}`, 500);
    }

    const byKey: Record<string, { value: Record<string, unknown>; updated_at: string | null }> = {};
    for (const row of (settingsRows ?? []) as Array<{
      key: string;
      value: Record<string, unknown> | null;
      updated_at: string | null;
    }>) {
      byKey[row.key] = {
        value: (row.value ?? {}) as Record<string, unknown>,
        updated_at: row.updated_at,
      };
    }

    const generalRaw = byKey["general"]?.value ?? {};
    const testModeRaw = byKey["test_mode_bypass"]?.value ?? {};
    const slaRaw = byKey["outreach_sla"]?.value ?? {};

    const gates: Record<string, boolean> = {};
    for (const g of TEST_MODE_GATES) {
      gates[g] = testModeRaw[g] === true;
    }

    // ── Cross-check via the SECURITY DEFINER RPC for each gate ────────────
    // (catches the "settings row says X but RPC returns Y" class of bugs).
    const rpcGates: Record<string, boolean | string> = {};
    for (const g of TEST_MODE_GATES) {
      const { data, error } = await adminClient.rpc("is_test_mode_bypass_enabled", { _gate: g });
      rpcGates[g] = error ? `rpc_error: ${error.message}` : data === true;
    }

    // ── Email suppression count (frequent culprit for "email never sent") ─
    // NOTE: actual table name is `suppressed_emails` (see other edge functions).
    let suppressionCount: number | string = 0;
    try {
      const { count, error } = await adminClient
        .from("suppressed_emails")
        .select("*", { count: "exact", head: true });
      suppressionCount = error ? `error: ${error.message}` : count ?? 0;
    } catch (err) {
      suppressionCount = `exception: ${err instanceof Error ? err.message : String(err)}`;
    }

    const body = {
      requestId,
      timestamp: new Date().toISOString(),
      caller: {
        userId: callerId,
        email: callerEmail,
        roles,
        isPlatformAdmin,
      },
      maintenance: {
        enabled: generalRaw.maintenanceMode === true,
        siteName: generalRaw.siteName ?? null,
        allowNewRegistrations: generalRaw.allowNewRegistrations ?? null,
        updatedAt: byKey["general"]?.updated_at ?? null,
        raw: generalRaw,
      },
      testMode: {
        masterEnabled: testModeRaw.enabled === true,
        gates,
        rpcGates,
        note: typeof testModeRaw.note === "string" ? testModeRaw.note : "",
        updatedAt: byKey["test_mode_bypass"]?.updated_at ?? null,
        raw: testModeRaw,
      },
      outreachSla: {
        ...slaRaw,
        updatedAt: byKey["outreach_sla"]?.updated_at ?? null,
      },
      emailSuppressionListSize: suppressionCount,
      environment: {
        supabaseUrl,
        hasServiceRoleKey: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
        hasResendKey: !!Deno.env.get("RESEND_API_KEY"),
        hasLovableApiKey: !!Deno.env.get("LOVABLE_API_KEY"),
        allowedOriginsConfigured: !!Deno.env.get("ALLOWED_ORIGINS"),
      },
      edgeRuntime: {
        denoVersion: (Deno as unknown as { version?: { deno?: string } }).version?.deno ?? "unknown",
        region: Deno.env.get("DENO_REGION") ?? Deno.env.get("SB_REGION") ?? null,
      },
    };

    logDecision("maintenance", {
      source: "debug-flags",
      decision: "allow",
      requestId,
      actorUserId: callerId,
      reason: "snapshot_returned",
      details: {
        maintenanceEnabled: body.maintenance.enabled,
        testModeMaster: body.testMode.masterEnabled,
        testModeGatesOn: Object.entries(gates).filter(([, v]) => v).map(([k]) => k),
      },
    });

    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err as Error, requestId, headers);
  }
});
