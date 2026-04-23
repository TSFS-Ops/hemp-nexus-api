/**
 * Test-mode bypass helper.
 *
 * While external compliance providers (IDV, sanctions/PEP, KYB, UBO, authority-to-bind)
 * are still being integrated, platform admins can flip per-gate flags in
 * `admin_settings.test_mode_bypass` so the rest of the platform stays testable.
 *
 * Every bypass MUST:
 *   1. Be explicitly enabled by an admin (master switch + per-gate flag).
 *   2. Write a `test_mode.bypass_used` row to `admin_audit_logs` so the
 *      bypass is fully visible in audit history.
 *   3. Tag any returned payload with `bypass: true` so downstream
 *      evidence packs can render a "TEST MODE" annotation.
 *
 * NEVER use this in production once real providers are wired in — gate
 * the master switch off and let normal validation run.
 */

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

export type BypassGate = "idv" | "sanctions" | "kyb" | "ubo" | "authority";

export interface BypassAuditContext {
  gate: BypassGate;
  /** Function name (e.g. "idv-verify") for audit traceability. */
  source: string;
  /** Org context for the audit row, if known. */
  orgId?: string | null;
  /** Acting user (null if invoked by API key / service role). */
  actorUserId?: string | null;
  /** Free-form metadata describing what was bypassed. */
  details?: Record<string, unknown>;
}

/**
 * Returns true when the master switch AND the requested gate flag are both on.
 * Uses the SECURITY DEFINER RPC so it works under any role (service / anon / authed).
 */
export async function isBypassEnabled(
  client: SupabaseClient,
  gate: BypassGate,
): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("is_test_mode_bypass_enabled", { _gate: gate });
    if (error) {
      console.error("[test-mode-bypass] RPC failed, defaulting to OFF:", error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[test-mode-bypass] unexpected error, defaulting to OFF:", err);
    return false;
  }
}

/**
 * Writes a high-visibility audit row whenever a bypass is actually used.
 * Failure to write the audit must NOT block the request — we log and continue.
 */
export async function recordBypassUsage(
  client: SupabaseClient,
  ctx: BypassAuditContext,
): Promise<void> {
  try {
    await client.from("admin_audit_logs").insert({
      action: "test_mode.bypass_used",
      target_type: "compliance_gate",
      target_id: ctx.orgId ?? null,
      admin_user_id: ctx.actorUserId ?? null,
      details: {
        gate: ctx.gate,
        source: ctx.source,
        org_id: ctx.orgId ?? null,
        ...ctx.details,
      },
    });
  } catch (err) {
    console.error("[test-mode-bypass] failed to write audit log:", err);
  }
}

/**
 * Convenience: returns a bypass result envelope for callers that want a
 * uniform shape across gates. Extend per-gate as needed.
 */
export function bypassEnvelope<T extends Record<string, unknown>>(
  payload: T,
): T & { bypass: true; bypass_reason: string } {
  return {
    ...payload,
    bypass: true,
    bypass_reason:
      "Test-mode bypass active — external integration not yet enabled. Result is for platform testing only.",
  };
}

/** Build a service-role client from env (helper used by edge functions). */
export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}
