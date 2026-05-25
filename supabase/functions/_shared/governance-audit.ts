/**
 * governance-audit.ts — Phase 2 canonical writer for Governance Record events.
 *
 * Backend-only. Never import from a browser component.
 *
 * Contract:
 *   - Writes go to public.event_store (canonical SSOT for new proof events).
 *   - Event names must come from CONTROLLED_TAXONOMY.
 *   - Critical families require a posture_snapshot.
 *   - Metadata is redacted before write.
 *   - Idempotency: same idempotency_key + aggregate_id within IDEMPOTENCY_WINDOW_MS
 *     returns the existing event_id without a second insert.
 *   - Critical writes throw on failure (caller MUST treat the underlying state
 *     change as failed and roll back / surface error). Best-effort writes
 *     log and resolve.
 *
 * Phase 1 UI compatibility: keep payload field names stable so
 *   src/lib/governance/governance-record.ts normaliseEventStore can read them.
 */

// deno-lint-ignore-file no-explicit-any

import {
  APPROVED_REASON_CODE_NAMESPACES,
  isApprovedNamespacedReasonCode,
  normaliseReasonCode,
} from "./governance-reason-codes.ts";

export {
  APPROVED_REASON_CODE_NAMESPACES,
  isApprovedNamespacedReasonCode,
  normaliseReasonCode,
};

// ── Controlled taxonomy ──────────────────────────────────────────────────────

export const EVENT_FAMILIES = [
  "trade_request",
  "match",
  "pending_engagement",
  "outreach",
  "counterparty",
  "poi",
  "wad",
  "execution",
  "admin",
  "hq",
  "dispute",
  "evidence",
  "payment",
  "credit",
  "finality",
  "memory",
  "export",
  "legal_hold",
  "demo",
  "system",
] as const;
export type EventFamily = (typeof EVENT_FAMILIES)[number];

/**
 * Whitelisted event names. Names not in this set are rejected.
 * Add new names here; never silently accept arbitrary strings.
 */
export const CONTROLLED_TAXONOMY = new Set<string>([
  // poi
  "poi.created",
  "poi.state_changed",
  "poi.blocked",
  // wad
  "wad.check_started",
  "wad.check_passed",
  "wad.check_failed",
  "wad.manual_review_required",
  "wad.passed",
  "wad.failed",
  // execution
  "execution.blocked",
  "execution.permitted",
  // pending_engagement
  "pending_engagement.created",
  "pending_engagement.outreach_sent",
  "pending_engagement.outreach_blocked",
  "pending_engagement.binding_review_required",
  "pending_engagement.late_acceptance_recorded",
  // dispute
  "dispute.opened",
  "dispute.released",
  "dispute.closed",
  // admin
  "admin.hq_decision_recorded",
  "admin.mfa_required_denied",
  // hq notes / corrections (Batch B — append-only, original event never edited)
  "hq.note_added",
  "hq.event_corrected",
  // credit / payment
  "credit.burn_attempted",
  "credit.burned",
  "credit.burn_blocked",
  "payment.event_created",
  // finality / memory / export
  "finality.recorded",
  "memory.record_created",
  "export.governance_record_exported",
  // legal_hold
  "legal_hold.applied",
  "legal_hold.released",
  // demo / system
  "demo.event_recorded",
  "system.audit_writer_health_check",
]);

// ── Controlled reason codes (David's approved list, non-document subset) ─────
// WARN-only enforcement: writes are not rejected when reason_code is unknown,
// but a structured warning is logged so HQ can audit drift. Document-specific
// reason codes are intentionally excluded — they belong to the separate
// AI/documentation-governance scope.
export const APPROVED_REASON_CODES: ReadonlySet<string> = new Set([
  // Blocked reason codes
  "missing_email",
  "missing_name",
  "binding_review_required",
  "expired_engagement",
  "late_acceptance_needs_reconfirmation",
  "dispute_active",
  "counterparty_not_accepted",
  "wad_not_passed",
  "wad_manual_review_required",
  "stale_verification",
  "missing_authority",
  "mfa_required",
  "insufficient_permission",
  "payment_unsettled",
  "credit_burn_not_allowed",
  "demo_test_block",
  "legal_hold_active",
  // Admin-decision reason codes
  "client_instruction",
  "incorrect_data_correction",
  "manual_verification_completed",
  "duplicate_or_mistaken_record",
  "dispute_reviewed",
  "late_acceptance_approved",
  "payment_correction",
  "system_recovery",
  "legal_hold",
  "other",
]);

/**
 * WARN-only validator for reason codes. Returns true when the code is on the
 * approved list (or absent/null). When the code is present but unknown, logs
 * a structured warning and returns false. Never throws — production flows use
 * many legacy/dynamic codes (e.g. "charge.success", "api:endpoint",
 * "scope:org") that must keep working until a separate enforcement phase.
 */
/**
 * True when the reason_code is on the David-approved business allow-list OR
 * carries one of the controlled namespace prefixes (legacy:, system:,
 * payment:, api:, action:, scope:). Absent/null is treated as approved
 * because reason_code is optional.
 *
 * NOTE: callers should pass the NORMALISED code (run `normaliseReasonCode`
 * first). The canonical writer normalises inside validateGovernanceInput.
 */
export function isApprovedReasonCode(code: string | null | undefined): boolean {
  if (!code) return true;
  if (APPROVED_REASON_CODES.has(code)) return true;
  if (isApprovedNamespacedReasonCode(code)) return true;
  return false;
}

export function warnIfUnknownReasonCode(
  code: string | null | undefined,
  ctx: { event_type: string; aggregate_id: string; source_function?: string | null },
): void {
  if (isApprovedReasonCode(code)) return;
  console.warn(
    "[governance-audit] reason_code outside approved list (WARN-only):",
    JSON.stringify({
      reason_code: code,
      event_type: ctx.event_type,
      aggregate_id: ctx.aggregate_id,
      source_function: ctx.source_function ?? null,
    }),
  );
}

/**
 * Critical families: posture_snapshot MUST be supplied, and writes MUST be
 * treated as fail-closed by callers (use writeCriticalGovernanceEvent).
 */
export const CRITICAL_FAMILIES: ReadonlySet<EventFamily> = new Set([
  "poi",
  "wad",
  "execution",
  "finality",
  "memory",
  "credit",
  "payment",
  "dispute",
  "export",
  // admin is only critical for hq_decision_recorded; handled specifically below.
]);

const CRITICAL_SPECIFIC_NAMES = new Set<string>([
  "admin.hq_decision_recorded",
  // Both HQ note types are fail-closed: David requires that a recorded note
  // or correction cannot silently fail to persist. The note family ("hq")
  // is not in CRITICAL_FAMILIES so they are opted-in by name here.
  "hq.note_added",
  "hq.event_corrected",
]);

// ── Posture labels ───────────────────────────────────────────────────────────

export type PostureLabel =
  | "Standard"
  | "Pending Verification"
  | "Manual Review Required"
  | "Waiver Applied"
  | "Bypass Applied"
  | "Demo/Test"
  | "Failed Verification"
  | "Expired/Stale Verification"
  | "Not recorded";

export const POSTURE_LABELS: ReadonlySet<PostureLabel> = new Set([
  "Standard",
  "Pending Verification",
  "Manual Review Required",
  "Waiver Applied",
  "Bypass Applied",
  "Demo/Test",
  "Failed Verification",
  "Expired/Stale Verification",
  "Not recorded",
]);

export interface PostureSnapshot {
  verification_posture: PostureLabel;
  /** Set when verification_posture is "Not recorded". */
  posture_reason?: string;
  policy_version?: string | null;
  provider_mode?: string | null;
  waiver_applied?: boolean;
  bypass_applied?: boolean;
  demo?: boolean;
  test_mode?: boolean;
  evidence_level?: string | null;
  check_status_snapshot?: Record<string, unknown> | null;
  stale_verification?: boolean;
  manual_review_required?: boolean;
}

// ── Redaction ────────────────────────────────────────────────────────────────

const REDACTED_KEYS = new Set([
  "password", "secret", "api_key", "apikey", "auth_token", "access_token",
  "refresh_token", "bearer", "card_number", "pan", "cvv", "cvc",
  "raw_payload", "provider_payload", "raw_response", "document_contents",
  "document_url", "passport_number", "id_number", "national_id",
  "private_key", "service_role",
]);
const REDACTED = "[redacted]";

export function redactMetadata(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6 || input == null || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (REDACTED_KEYS.has(lower) || /token|secret|password|payload/.test(lower)) {
      out[k] = REDACTED;
      continue;
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = redactMetadata(v, depth + 1);
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, 25).map((x) =>
        x && typeof x === "object" ? redactMetadata(x, depth + 1) : x,
      );
    } else if (typeof v === "string" && v.length > 2000) {
      out[k] = v.slice(0, 2000) + "…[truncated]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Hash chain ───────────────────────────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  // deno-lint-ignore no-explicit-any
  const buf = await (globalThis.crypto as any).subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Domain mapping ───────────────────────────────────────────────────────────
// event_store.domain CHECK constraint: trade | trust | core | intel

const FAMILY_TO_DOMAIN: Record<EventFamily, "trade" | "trust" | "core" | "intel"> = {
  trade_request: "trade",
  match: "trade",
  pending_engagement: "trade",
  outreach: "trade",
  counterparty: "trade",
  poi: "trust",
  wad: "trust",
  evidence: "trust",
  legal_hold: "trust",
  execution: "trade",
  finality: "trade",
  payment: "trade",
  credit: "trade",
  dispute: "trade",
  admin: "core",
  hq: "core",
  memory: "core",
  export: "core",
  demo: "core",
  system: "core",
};

// ── Writer types ─────────────────────────────────────────────────────────────

export interface GovernanceWriteInput {
  /** Whitelisted event name, e.g. "poi.state_changed". */
  event_type: string;
  org_id: string;
  aggregate_type: string;
  aggregate_id: string;

  actor_user_id?: string | null;
  actor_role?: string | null;
  actor_org_id?: string | null;
  system_actor?: string | null; // e.g. "lifecycle-scheduler"

  /** Source backend function or RPC name. REQUIRED. */
  source_function: string;
  /** Request / trace identifier from the inbound HTTP call. */
  request_id?: string | null;
  /** Correlation id binding all events of the same user action. */
  correlation_id?: string | null;
  /** Optional idempotency key — if the same key+aggregate is seen inside the
   *  idempotency window the existing event is returned. */
  idempotency_key?: string | null;

  /** Linked ids. Stored in payload.links. */
  match_id?: string | null;
  poi_id?: string | null;
  wad_id?: string | null;
  engagement_id?: string | null;
  payment_reference?: string | null;
  credit_ledger_id?: string | null;

  previous_state?: string | null;
  new_state?: string | null;
  allowed_or_blocked?: "allowed" | "blocked" | "manual_review" | "neutral";
  reason_code?: string | null;

  /** REQUIRED for CRITICAL_FAMILIES + CRITICAL_SPECIFIC_NAMES. */
  posture_snapshot?: PostureSnapshot;

  /** Free-form safe metadata. Will be redacted. */
  metadata?: Record<string, unknown>;
}

export interface GovernanceWriteResult {
  event_id: string;
  deduplicated: boolean;
}

const IDEMPOTENCY_WINDOW_MS = 5 * 60 * 1000;

// Validation extracted so tests can exercise it without a DB client.
export function validateGovernanceInput(input: GovernanceWriteInput): void {
  if (!input.event_type || typeof input.event_type !== "string") {
    throw new Error("GOV_AUDIT_INVALID: event_type required");
  }
  if (!CONTROLLED_TAXONOMY.has(input.event_type)) {
    throw new Error(`GOV_AUDIT_UNKNOWN_EVENT: "${input.event_type}" not in controlled taxonomy`);
  }
  const family = input.event_type.split(".")[0] as EventFamily;
  if (!(EVENT_FAMILIES as readonly string[]).includes(family)) {
    throw new Error(`GOV_AUDIT_UNKNOWN_FAMILY: "${family}"`);
  }
  if (!input.org_id) throw new Error("GOV_AUDIT_INVALID: org_id required");
  if (!input.aggregate_type) throw new Error("GOV_AUDIT_INVALID: aggregate_type required");
  if (!input.aggregate_id) throw new Error("GOV_AUDIT_INVALID: aggregate_id required");
  if (!input.source_function) throw new Error("GOV_AUDIT_INVALID: source_function required");
  if (!input.actor_user_id && !input.system_actor) {
    throw new Error("GOV_AUDIT_INVALID: actor_user_id or system_actor required");
  }

  const critical = CRITICAL_FAMILIES.has(family) || CRITICAL_SPECIFIC_NAMES.has(input.event_type);
  if (critical) {
    const p = input.posture_snapshot;
    if (!p || !p.verification_posture) {
      throw new Error(`GOV_AUDIT_POSTURE_REQUIRED: ${input.event_type} requires posture_snapshot.verification_posture`);
    }
    if (!POSTURE_LABELS.has(p.verification_posture)) {
      throw new Error(`GOV_AUDIT_POSTURE_INVALID: "${p.verification_posture}" not a controlled label`);
    }
    if (p.verification_posture === "Not recorded" && !p.posture_reason) {
      throw new Error("GOV_AUDIT_POSTURE_REASON_REQUIRED: posture 'Not recorded' must include posture_reason");
    }
  }

  // Batch C — normalise legacy/provider-shaped reason codes into controlled
  // namespaces (WARN-only). Preserve the original literal in safe metadata
  // as `original_reason_code` when normalisation actually changed the value.
  // The canonical payload then carries the normalised value going forward.
  const rawReason = input.reason_code ?? null;
  const normalisedReason = normaliseReasonCode(rawReason);
  if (rawReason && normalisedReason && rawReason !== normalisedReason) {
    input.metadata = {
      ...(input.metadata ?? {}),
      original_reason_code: rawReason,
    };
  }
  input.reason_code = normalisedReason;

  // WARN-only reason-code allow-list check (does not throw).
  warnIfUnknownReasonCode(input.reason_code ?? null, {
    event_type: input.event_type,
    aggregate_id: input.aggregate_id,
    source_function: input.source_function,
  });
}

export function isCriticalEvent(event_type: string): boolean {
  const family = event_type.split(".")[0] as EventFamily;
  return CRITICAL_FAMILIES.has(family) || CRITICAL_SPECIFIC_NAMES.has(event_type);
}

export function domainFor(event_type: string): "trade" | "trust" | "core" | "intel" {
  const family = event_type.split(".")[0] as EventFamily;
  return FAMILY_TO_DOMAIN[family] ?? "core";
}

/** Build the payload that gets persisted into event_store.payload. */
export function buildPayload(input: GovernanceWriteInput): Record<string, unknown> {
  const safeMeta = redactMetadata(input.metadata ?? {});
  return {
    // first-class fields surfaced for the Phase 1 UI normaliser
    source_function: input.source_function,
    request_id: input.request_id ?? null,
    correlation_id: input.correlation_id ?? null,
    idempotency_key: input.idempotency_key ?? null,
    previous_state: input.previous_state ?? null,
    new_state: input.new_state ?? null,
    allowed_or_blocked: input.allowed_or_blocked ?? "neutral",
    reason: input.reason_code ?? null,
    reason_code: input.reason_code ?? null,
    posture: input.posture_snapshot?.verification_posture ?? "Not recorded",
    posture_snapshot: input.posture_snapshot ?? null,
    policy_version: input.posture_snapshot?.policy_version ?? null,
    actor_role: input.actor_role ?? null,
    actor_org_id: input.actor_org_id ?? null,
    system_actor: input.system_actor ?? null,
    links: {
      match_id: input.match_id ?? null,
      poi_id: input.poi_id ?? null,
      wad_id: input.wad_id ?? null,
      engagement_id: input.engagement_id ?? null,
      payment_reference: input.payment_reference ?? null,
      credit_ledger_id: input.credit_ledger_id ?? null,
    },
    // mirror commonly-queried link fields at the root so UIs that filter on
    // `payload->>match_id` keep working.
    match_id: input.match_id ?? null,
    poi_id: input.poi_id ?? null,
    metadata: safeMeta,
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Minimal subset of the Supabase admin client we need. Accepts any client
 * implementing this shape so we can unit-test with a fake.
 */
export interface AdminLike {
  from(table: string): {
    select: (cols: string) => {
      eq: (col: string, v: any) => any;
      filter?: (...args: any[]) => any;
      order?: (...args: any[]) => any;
      limit?: (n: number) => any;
      maybeSingle?: () => Promise<{ data: any; error: any }>;
    };
    insert: (row: any) => {
      select: (cols: string) => {
        single: () => Promise<{ data: any; error: any }>;
      };
    };
  };
}

async function findIdempotent(
  admin: AdminLike,
  input: GovernanceWriteInput,
): Promise<string | null> {
  if (!input.idempotency_key) return null;
  const sinceIso = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
  const q: any = admin.from("event_store");
  const built = q
    .select("id, occurred_at, payload")
    .eq("aggregate_id", input.aggregate_id)
    .eq("event_type", input.event_type);
  const { data, error } = await (built.gte
    ? built.gte("occurred_at", sinceIso).limit(50)
    : built.limit(50));
  if (error) return null;
  for (const r of (data ?? []) as any[]) {
    if (r?.payload?.idempotency_key === input.idempotency_key) return r.id;
  }
  return null;
}

async function lastEventHash(
  admin: AdminLike,
  org_id: string,
  aggregate_type: string,
  aggregate_id: string,
): Promise<string | null> {
  try {
    const q: any = admin.from("event_store").select("event_hash");
    const built = q
      .eq("org_id", org_id)
      .eq("aggregate_type", aggregate_type)
      .eq("aggregate_id", aggregate_id);
    const { data } = await (built.order
      ? built.order("occurred_at", { ascending: false }).limit(1)
      : built.limit(1));
    const row = Array.isArray(data) ? data[0] : data;
    return row?.event_hash ?? null;
  } catch {
    return null;
  }
}

async function insertGovernanceEvent(
  admin: AdminLike,
  input: GovernanceWriteInput,
): Promise<GovernanceWriteResult> {
  validateGovernanceInput(input);

  const existing = await findIdempotent(admin, input);
  if (existing) return { event_id: existing, deduplicated: true };

  const payload = buildPayload(input);
  const prev_hash = await lastEventHash(admin, input.org_id, input.aggregate_type, input.aggregate_id);

  const occurred_at = new Date().toISOString();
  const event_hash = await sha256Hex(
    JSON.stringify({
      prev_hash,
      org_id: input.org_id,
      aggregate_type: input.aggregate_type,
      aggregate_id: input.aggregate_id,
      event_type: input.event_type,
      occurred_at,
      payload,
    }),
  );

  const row = {
    org_id: input.org_id,
    domain: domainFor(input.event_type),
    aggregate_type: input.aggregate_type,
    aggregate_id: input.aggregate_id,
    event_type: input.event_type,
    occurred_at,
    actor_id: input.actor_user_id ?? null,
    actor_role: input.actor_role ?? (input.system_actor ? "system" : null),
    payload,
    prev_hash,
    event_hash,
  };

  const { data, error } = await admin
    .from("event_store")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`GOV_AUDIT_WRITE_FAILED: ${error.message ?? error}`);
  return { event_id: data.id, deduplicated: false };
}

/**
 * Critical-event writer. Throws on any failure. Callers MUST treat the
 * underlying business state change as failed when this throws (fail-closed).
 *
 * The writer also asserts the event is in CRITICAL_FAMILIES / CRITICAL_SPECIFIC_NAMES
 * so a caller cannot accidentally bypass the contract with a non-critical name.
 */
export async function writeCriticalGovernanceEvent(
  admin: AdminLike,
  input: GovernanceWriteInput,
): Promise<GovernanceWriteResult> {
  if (!isCriticalEvent(input.event_type)) {
    throw new Error(
      `GOV_AUDIT_NOT_CRITICAL: ${input.event_type} is not in the critical set; use writeGovernanceEventBestEffort`,
    );
  }
  return await insertGovernanceEvent(admin, input);
}

/**
 * Non-critical writer. Logs failures but resolves; suitable for view-only
 * observability events. Returns null on failure.
 */
export async function writeGovernanceEventBestEffort(
  admin: AdminLike,
  input: GovernanceWriteInput,
): Promise<GovernanceWriteResult | null> {
  try {
    return await insertGovernanceEvent(admin, input);
  } catch (e) {
    console.error("[governance-audit] best-effort write failed:", (e as Error).message, {
      event_type: input.event_type,
      aggregate_id: input.aggregate_id,
    });
    return null;
  }
}
