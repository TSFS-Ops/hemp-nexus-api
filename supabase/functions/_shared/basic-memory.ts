/**
 * Basic Memory Record v1 — internal writer client (shared helper).
 *
 * Lightweight, fail-OPEN best-effort wrapper around the
 * `basic-memory-record-write` edge function. Source edge functions
 * (collapse, wad seal, dispute resolve) call `writeBasicMemoryRecord`
 * AFTER their primary action has committed.
 *
 * Contract:
 *   - NEVER throws. A Memory failure must NOT reverse or block the
 *     underlying collapse / WaD / dispute action.
 *   - NEVER logs secrets, headers, or raw provider payloads.
 *   - Uses `INTERNAL_CRON_KEY` if available, otherwise falls back to
 *     `SUPABASE_SERVICE_ROLE_KEY` bearer (matches existing internal
 *     call patterns: burn-poi-reconciliation, account-deletion-sweeper).
 *   - Duplicate-tolerant: the writer returns 200 with the existing row
 *     on UNIQUE(trigger_event_type, source_record_id) replay; we treat
 *     both 200 and 201 as success.
 *
 * v1 vocabulary (mirror of src/lib/basic-memory/outcomes.ts and the
 * CHECK constraints on public.basic_memory_records). Drift is
 * prevented by scripts/check-basic-memory-vocab-drift.mjs.
 */

export type BasicMemoryTrigger =
  | "finality.collapsed"
  | "wad.sealed"
  | "dispute.resolved";

export type BasicMemoryOutcome =
  | "completed"
  | "wad_sealed"
  | "dispute_resolved";

export type BasicMemoryReason =
  | "collapse_recorded"
  | "attestations_complete"
  | "dispute_resolved";

export type BasicMemoryEnvironment = "live" | "demo" | "test";

export interface BasicMemoryWritePayload {
  trigger_event_type: BasicMemoryTrigger;
  outcome: BasicMemoryOutcome;
  outcome_reason: BasicMemoryReason;
  outcome_summary?: string | null;
  match_id?: string | null;
  poi_id?: string | null;
  wad_id?: string | null;
  engagement_id?: string | null;
  dispute_id?: string | null;
  source_table: string;
  source_record_id: string;
  source_function: string;
  status_snapshot?: Record<string, unknown>;
  audit_event_ids?: string[];
  environment_classification: BasicMemoryEnvironment;
}

export interface BasicMemoryWriteResult {
  ok: boolean;
  status?: number;
  duplicate?: boolean;
  /** Stable opaque error code; no raw DB / network detail leaked. */
  errorCode?:
    | "MISCONFIGURED"
    | "VALIDATION"
    | "UNAUTHORIZED"
    | "WRITE_FAILED"
    | "NETWORK"
    | "EXCEPTION";
}

const FN_PATH = "/functions/v1/basic-memory-record-write";

export async function writeBasicMemoryRecord(
  payload: BasicMemoryWritePayload,
  opts: { requestId?: string } = {},
): Promise<BasicMemoryWriteResult> {
  const tag = `[basic-memory] ${opts.requestId ?? ""}`.trim();
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const INTERNAL_KEY = Deno.env.get("INTERNAL_CRON_KEY") ?? "";

    if (!SUPABASE_URL || (!SERVICE_ROLE && !INTERNAL_KEY)) {
      console.warn(`${tag} writer not configured; skipping (fail-open)`);
      return { ok: false, errorCode: "MISCONFIGURED" };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (INTERNAL_KEY) {
      headers["x-internal-key"] = INTERNAL_KEY;
    } else {
      headers["authorization"] = `Bearer ${SERVICE_ROLE}`;
    }

    const res = await fetch(`${SUPABASE_URL}${FN_PATH}`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    // Always drain the body to avoid resource leaks even on error.
    let body: { duplicate?: boolean; error?: string } | null = null;
    try {
      const txt = await res.text();
      body = txt ? JSON.parse(txt) : null;
    } catch {
      body = null;
    }

    if (res.status === 200 || res.status === 201) {
      return {
        ok: true,
        status: res.status,
        duplicate: !!body?.duplicate,
      };
    }
    if (res.status === 401) {
      console.warn(
        `${tag} writer rejected with 401 (fail-open) trigger=${payload.trigger_event_type}`,
      );
      return { ok: false, status: 401, errorCode: "UNAUTHORIZED" };
    }
    if (res.status === 400) {
      // Validation issue at the writer — log opaque code only.
      console.warn(
        `${tag} writer validation failed trigger=${payload.trigger_event_type} code=${body?.error ?? "unknown"}`,
      );
      return { ok: false, status: 400, errorCode: "VALIDATION" };
    }
    console.warn(
      `${tag} writer non-2xx trigger=${payload.trigger_event_type} status=${res.status}`,
    );
    return { ok: false, status: res.status, errorCode: "WRITE_FAILED" };
  } catch (err) {
    // Fail-open: log opaque message, never throw into the primary flow.
    const msg = err instanceof Error ? err.message : "exception";
    console.warn(
      `${tag} writer threw (fail-open) trigger=${payload.trigger_event_type}: ${msg}`,
    );
    return { ok: false, errorCode: "EXCEPTION" };
  }
}

/**
 * Derive environment_classification from the linked match. Reads
 * `matches.is_demo` if available; defaults to "live". Never throws.
 *
 * We intentionally do NOT introduce a separate "test" environment
 * derivation in v1 — the test environment is reserved for explicit
 * test-suite fixtures and is set by callers directly.
 */
export async function deriveEnvironmentFromMatch(
  // deno-lint-ignore no-explicit-any
  admin: any,
  matchId: string | null | undefined,
): Promise<BasicMemoryEnvironment> {
  if (!matchId) return "live";
  try {
    const { data } = await admin
      .from("matches")
      .select("is_demo")
      .eq("id", matchId)
      .maybeSingle();
    return data?.is_demo === true ? "demo" : "live";
  } catch {
    return "live";
  }
}
