/**
 * Governance Record (Phase 1) — shared types, merging, categorisation,
 * actor inference, posture labels, and redaction.
 *
 * Phase 1 contract: HQ-only. Reads existing audit sources (audit_logs,
 * admin_audit_logs, event_store, match_events). Does NOT migrate data,
 * does NOT mutate state, does NOT expose raw provider payloads.
 *
 * If extending: keep this file pure (no React, no supabase imports) so the
 * unit tests can exercise it directly.
 */

export type GovernanceSource =
  | "audit_logs"
  | "admin_audit_logs"
  | "event_store"
  | "match_events";

export type ActorType =
  | "System"
  | "User"
  | "Organisation Admin"
  | "HQ Admin"
  | "Provider"
  | "Scheduled Job"
  | "Payment Provider"
  | "Notification Service"
  | "Unknown actor — needs review";

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

export type EventCategory =
  | "trade_request"
  | "match"
  | "engagement"
  | "outreach"
  | "contact"
  | "counterparty"
  | "binding"
  | "poi"
  | "wad"
  | "execution"
  | "admin_review"
  | "hq_decision"
  | "hq_note"
  | "hq_correction"
  | "dispute"
  | "credit"
  | "payment"
  | "evidence"
  | "finality"
  | "memory"
  | "export"
  | "sensitive_admin"
  | "demo_test"
  | "other";

export type AllowedStatus = "allowed" | "blocked" | "manual_review" | "neutral";

export interface GovernanceEvent {
  /** Stable composite id for React keys: source + source row id. */
  id: string;
  source: GovernanceSource;
  sourceRowId: string;
  /** Raw action / event_type string from the source row. */
  action: string;
  /** Inferred high-level category for filtering. */
  category: EventCategory;
  /** ISO timestamp of the event. */
  occurredAt: string;
  /** Inferred allowed / blocked / manual_review / neutral. */
  status: AllowedStatus;
  /** Reason code if the event is a block or manual review. */
  reasonCode?: string | null;
  /** Inferred actor type. */
  actorType: ActorType;
  /** Actor user / api key id where present. */
  actorId?: string | null;
  /** Posture label snapshot if present in the row metadata. */
  posture: PostureLabel;
  /** True when row is flagged is_demo or carries demo_dataset_id. */
  isDemo: boolean;
  /** match_id / poi_id / engagement_id / payment_reference / wad_id where inferable. */
  links: {
    matchId?: string | null;
    poiId?: string | null;
    engagementId?: string | null;
    wadId?: string | null;
    paymentReference?: string | null;
    orgId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  };
  /** Redacted metadata safe for HQ display. Raw provider payloads stripped. */
  safeMetadata: Record<string, unknown>;
  /** Previous / new state if present. */
  prevState?: string | null;
  newState?: string | null;
  /**
   * Batch B — populated by `annotateCorrections` when a later
   * `hq.event_corrected` event references this row. Original event is
   * never edited; this is purely a derived UI hint.
   */
  correctedBy?: CorrectionRef | null;
}

export interface CorrectionRef {
  eventId: string;
  occurredAt: string;
  actorId?: string | null;
  reasonCode?: string | null;
  note?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Redaction — never let secrets leak into the HQ timeline.
// ─────────────────────────────────────────────────────────────────────────────

const REDACTED_KEYS = new Set([
  "password",
  "secret",
  "api_key",
  "apikey",
  "auth_token",
  "access_token",
  "refresh_token",
  "bearer",
  "card_number",
  "pan",
  "cvv",
  "cvc",
  "raw_payload",
  "provider_payload",
  "raw_response",
  "document_contents",
  "document_url",
  "passport_number",
  "id_number",
  "national_id",
  "private_key",
  "service_role",
]);

const REDACTED_PLACEHOLDER = "[redacted]";

export function redactMetadata(input: unknown, depth = 0): Record<string, unknown> {
  if (depth > 6 || input == null || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const lower = key.toLowerCase();
    if (REDACTED_KEYS.has(lower) || /token|secret|password|payload/.test(lower)) {
      out[key] = REDACTED_PLACEHOLDER;
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactMetadata(value, depth + 1);
    } else if (Array.isArray(value)) {
      out[key] = value.slice(0, 25).map((v) =>
        v && typeof v === "object" ? redactMetadata(v, depth + 1) : v,
      );
    } else if (typeof value === "string" && value.length > 2000) {
      out[key] = value.slice(0, 2000) + "…[truncated]";
    } else {
      out[key] = value;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Category inference — string-prefix based, conservative.
// Unknown actions fall to "other"; UI shows raw action name.
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_RULES: Array<{ test: RegExp; cat: EventCategory }> = [
  // HQ notes / corrections must be matched before the generic admin / hq_decision
  // rule so they get their own controlled label and never fold into hq_decision.
  { test: /^hq\.note_added$/i, cat: "hq_note" },
  { test: /^hq\.event_corrected$/i, cat: "hq_correction" },
  { test: /^trade_request\.|^mt[-_]?012/i, cat: "trade_request" },
  { test: /^match\./i, cat: "match" },
  { test: /^poi\.|poi_/i, cat: "poi" },
  { test: /^wad\.|wad_|warrant/i, cat: "wad" },
  { test: /^outreach\./i, cat: "outreach" },
  { test: /engagement/i, cat: "engagement" },
  { test: /binding/i, cat: "binding" },
  { test: /contact/i, cat: "contact" },
  { test: /counterparty/i, cat: "counterparty" },
  { test: /execution/i, cat: "execution" },
  { test: /admin_risk_item|admin\.review|review\./i, cat: "admin_review" },
  { test: /admin\.manual_override|break_glass|hq\.decision|admin\.override/i, cat: "hq_decision" },
  { test: /dispute/i, cat: "dispute" },
  { test: /credit|token_ledger|atomic_token/i, cat: "credit" },
  { test: /payment|paystack|refund|chargeback/i, cat: "payment" },
  { test: /evidence|document\./i, cat: "evidence" },
  { test: /finality|collapse/i, cat: "finality" },
  { test: /memory|transaction_memory/i, cat: "memory" },
  { test: /export|download/i, cat: "export" },
  { test: /demo|test_mode/i, cat: "demo_test" },
  { test: /admin\./i, cat: "sensitive_admin" },
];

export function categoriseAction(action: string): EventCategory {
  for (const r of CATEGORY_RULES) {
    if (r.test.test(action)) return r.cat;
  }
  return "other";
}

// ─────────────────────────────────────────────────────────────────────────────
// Status inference — allowed / blocked / manual_review / neutral.
// ─────────────────────────────────────────────────────────────────────────────

export function inferStatus(action: string, metadata: Record<string, unknown>): AllowedStatus {
  const a = action.toLowerCase();
  if (/blocked|denied|rejected|failed|burn_blocked/.test(a)) return "blocked";
  if (/manual_review|review_required|awaiting_review/.test(a)) return "manual_review";
  // Heuristic from metadata
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (m.blocked === true || m.allowed === false) return "blocked";
    if (m.manual_review === true) return "manual_review";
    if (m.allowed === true) return "allowed";
  }
  if (/created|sent|burned|recorded|attempt|started|passed|accepted|granted|permitted|completed/.test(a)) {
    return "allowed";
  }
  return "neutral";
}

// ─────────────────────────────────────────────────────────────────────────────
// Actor inference.
// ─────────────────────────────────────────────────────────────────────────────

export function inferActorType(opts: {
  source: GovernanceSource;
  actorRole?: string | null;
  actorId?: string | null;
  apiKeyId?: string | null;
  action: string;
}): ActorType {
  const { source, actorRole, actorId, apiKeyId, action } = opts;
  if (source === "admin_audit_logs") return "HQ Admin";
  if (actorRole) {
    const r = actorRole.toLowerCase();
    if (r.includes("platform_admin") || r.includes("hq")) return "HQ Admin";
    if (r.includes("org_admin")) return "Organisation Admin";
    if (r.includes("system")) return "System";
    if (r.includes("provider")) return "Provider";
    if (r.includes("scheduler") || r.includes("cron") || r.includes("job")) return "Scheduled Job";
    if (r.includes("payment") || r.includes("paystack")) return "Payment Provider";
    if (r.includes("notify") || r.includes("resend")) return "Notification Service";
    if (r.includes("user")) return "User";
  }
  if (apiKeyId) return "User";
  if (/scheduler|cron|sweeper|lifecycle/.test(action)) return "Scheduled Job";
  if (/paystack|payment|refund|chargeback/.test(action)) return "Payment Provider";
  if (/email|resend|notification/.test(action)) return "Notification Service";
  if (actorId) return "User";
  if (/system|atomic_/.test(action)) return "System";
  return "Unknown actor — needs review";
}

// ─────────────────────────────────────────────────────────────────────────────
// Posture inference — only return labelled values, otherwise "Not recorded".
// ─────────────────────────────────────────────────────────────────────────────

const POSTURE_MAP: Record<string, PostureLabel> = {
  standard: "Standard",
  pending: "Pending Verification",
  pending_verification: "Pending Verification",
  manual_review: "Manual Review Required",
  manual_review_required: "Manual Review Required",
  waiver: "Waiver Applied",
  waiver_applied: "Waiver Applied",
  bypass: "Bypass Applied",
  bypass_applied: "Bypass Applied",
  demo: "Demo/Test",
  test: "Demo/Test",
  demo_test: "Demo/Test",
  failed: "Failed Verification",
  failed_verification: "Failed Verification",
  expired: "Expired/Stale Verification",
  stale: "Expired/Stale Verification",
};

export function inferPosture(metadata: Record<string, unknown>, isDemo: boolean): PostureLabel {
  if (isDemo) return "Demo/Test";
  const raw =
    (metadata?.posture as string | undefined) ??
    (metadata?.verification_posture as string | undefined) ??
    (metadata?.governance_posture as string | undefined);
  if (!raw) return "Not recorded";
  return POSTURE_MAP[String(raw).toLowerCase()] ?? "Not recorded";
}

// ─────────────────────────────────────────────────────────────────────────────
// Link extraction.
// ─────────────────────────────────────────────────────────────────────────────

export function extractLinks(opts: {
  entityType?: string | null;
  entityId?: string | null;
  metadata: Record<string, unknown>;
  orgId?: string | null;
}): GovernanceEvent["links"] {
  const { entityType, entityId, metadata, orgId } = opts;
  const m = metadata ?? {};
  const get = (k: string) => (m[k] as string | undefined) ?? null;

  let matchId = get("match_id");
  let poiId = get("poi_id");
  let engagementId = get("engagement_id") ?? get("pending_engagement_id");
  const wadId = get("wad_id") ?? get("p3_wad_id");
  const paymentReference = get("payment_reference") ?? get("paystack_reference");

  if (entityType === "match" && entityId) matchId ??= entityId;
  if (entityType === "poi" && entityId) poiId ??= entityId;
  if (entityType === "engagement" && entityId) engagementId ??= entityId;

  return {
    matchId,
    poiId,
    engagementId,
    wadId,
    paymentReference,
    orgId: orgId ?? get("org_id"),
    entityType: entityType ?? null,
    entityId: entityId ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalisers — convert each source row into a GovernanceEvent.
// ─────────────────────────────────────────────────────────────────────────────

export function normaliseAuditLog(row: any): GovernanceEvent {
  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  const safe = redactMetadata(metadata);
  const action = String(row.action ?? "");
  const isDemo = Boolean(row.is_demo || row.demo_dataset_id);
  return {
    id: `audit_logs:${row.id}`,
    source: "audit_logs",
    sourceRowId: row.id,
    action,
    category: categoriseAction(action),
    occurredAt: row.created_at,
    status: inferStatus(action, metadata),
    reasonCode: (metadata.reason as string) ?? (metadata.reason_code as string) ?? null,
    actorType: inferActorType({
      source: "audit_logs",
      actorRole: (metadata.actor_role as string) ?? null,
      actorId: row.actor_user_id,
      apiKeyId: row.actor_api_key_id,
      action,
    }),
    actorId: row.actor_user_id ?? row.actor_api_key_id ?? null,
    posture: inferPosture(metadata, isDemo),
    isDemo,
    links: extractLinks({
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata,
      orgId: row.org_id,
    }),
    safeMetadata: safe,
    prevState: (metadata.previous_state as string) ?? (metadata.from_state as string) ?? null,
    newState: (metadata.new_state as string) ?? (metadata.to_state as string) ?? null,
  };
}

export function normaliseAdminAuditLog(row: any): GovernanceEvent {
  const metadata = (row.details ?? {}) as Record<string, unknown>;
  const safe = redactMetadata(metadata);
  const action = String(row.action ?? "");
  return {
    id: `admin_audit_logs:${row.id}`,
    source: "admin_audit_logs",
    sourceRowId: row.id,
    action,
    category: categoriseAction(action) || "sensitive_admin",
    occurredAt: row.created_at,
    status: inferStatus(action, metadata),
    reasonCode: (metadata.reason as string) ?? null,
    actorType: "HQ Admin",
    actorId: row.admin_user_id,
    posture: inferPosture(metadata, false),
    isDemo: false,
    links: extractLinks({
      entityType: row.target_type,
      entityId: row.target_id,
      metadata,
    }),
    safeMetadata: safe,
  };
}

export function normaliseEventStore(row: any): GovernanceEvent {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const safe = redactMetadata(payload);
  const action = String(row.event_type ?? "");
  return {
    id: `event_store:${row.id}`,
    source: "event_store",
    sourceRowId: row.id,
    action,
    category: categoriseAction(action),
    occurredAt: row.occurred_at,
    status: inferStatus(action, payload),
    reasonCode: (payload.reason as string) ?? null,
    actorType: inferActorType({
      source: "event_store",
      actorRole: row.actor_role,
      actorId: row.actor_id,
      action,
    }),
    actorId: row.actor_id,
    posture: inferPosture(payload, false),
    isDemo: false,
    links: extractLinks({
      entityType: row.aggregate_type,
      entityId: row.aggregate_id,
      metadata: payload,
      orgId: row.org_id,
    }),
    safeMetadata: safe,
    prevState: (payload.previous_state as string) ?? (payload.from_state as string) ?? null,
    newState: (payload.new_state as string) ?? (payload.to_state as string) ?? null,
  };
}

export function normaliseMatchEvent(row: any): GovernanceEvent {
  const data = (row.event_data ?? {}) as Record<string, unknown>;
  const safe = redactMetadata(data);
  const action = String(row.event_type ?? "");
  return {
    id: `match_events:${row.id}`,
    source: "match_events",
    sourceRowId: row.id,
    action,
    category: categoriseAction(action),
    occurredAt: row.created_at,
    status: inferStatus(action, data),
    reasonCode: (data.reason as string) ?? null,
    actorType: inferActorType({
      source: "match_events",
      actorRole: null,
      actorId: row.actor_user_id,
      apiKeyId: row.actor_api_key_id,
      action,
    }),
    actorId: row.actor_user_id ?? row.actor_api_key_id ?? null,
    posture: inferPosture(data, false),
    isDemo: false,
    links: {
      matchId: row.match_id,
      poiId: (data.poi_id as string) ?? null,
      engagementId: (data.engagement_id as string) ?? null,
      wadId: (data.wad_id as string) ?? null,
      paymentReference: (data.payment_reference as string) ?? null,
      orgId: row.org_id,
      entityType: "match",
      entityId: row.match_id,
    },
    safeMetadata: safe,
    prevState: (data.previous_state as string) ?? (data.from_state as string) ?? null,
    newState: (data.new_state as string) ?? (data.to_state as string) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Merging — chronological sort, dedupe on (action, occurredAt±2s, matchId).
// Dedupe preserves the higher-trust source: event_store > match_events >
// audit_logs > admin_audit_logs. When uncertain we KEEP both and let the UI
// show source labels so HQ can audit origin.
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_TRUST: Record<GovernanceSource, number> = {
  event_store: 4,
  match_events: 3,
  audit_logs: 2,
  admin_audit_logs: 1,
};

export function mergeAndSort(events: GovernanceEvent[]): GovernanceEvent[] {
  const byKey = new Map<string, GovernanceEvent>();
  for (const e of events) {
    const tsBucket = Math.floor(new Date(e.occurredAt).getTime() / 2000);
    const key = `${e.action}|${tsBucket}|${e.links.matchId ?? ""}|${e.links.poiId ?? ""}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, e);
    } else if (SOURCE_TRUST[e.source] > SOURCE_TRUST[existing.source]) {
      byKey.set(key, e);
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Display copy — controlled wording per spec sections 7–11.
// ─────────────────────────────────────────────────────────────────────────────

export function statusCopy(e: GovernanceEvent): string {
  switch (e.status) {
    case "blocked":
      return `Action blocked. The platform prevented this step because ${
        e.reasonCode ? `"${e.reasonCode}"` : "the required condition"
      } was not satisfied.`;
    case "manual_review":
      return "Manual review required. The platform could not safely progress this item automatically. HQ must review the evidence and record a decision before progression can continue.";
    case "allowed":
      return "Action allowed. The platform permitted this step because the required workflow conditions were satisfied at the time of the action.";
    case "neutral":
    default:
      return "";
  }
}

export const NO_EVENT_COPY =
  "No recorded event found for this step. This may mean the step has not happened yet, or that this workflow has not written to the Governance Record.";

export const DEMO_EVENT_COPY =
  "Demo/test event — this did not trigger live outreach, billing, credit burn or production progression.";

export const HQ_DECISION_COPY =
  "HQ decision recorded. An authorised HQ user allowed this step after manual review. The reason and supporting note are recorded in the event details.";

export const MEMORY_NOT_WIRED_COPY =
  "Memory status is not wired into the Governance Record in this build. The Memory record subsystem will be connected in a later phase.";

// ─────────────────────────────────────────────────────────────────────────────
// Controlled reason codes — mirror of the backend WARN-only allow-list.
// Document-specific codes are intentionally excluded (separate AI/doc scope).
// ─────────────────────────────────────────────────────────────────────────────

export const APPROVED_REASON_CODES: ReadonlySet<string> = new Set([
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

// ─────────────────────────────────────────────────────────────────────────────
// Repeated-event grouping — UI-side only (does not change event_store writes).
// Same actor + same record/anchor + same event type + same reason code +
// same allowed/blocked status within 5 minutes → collapsed into one visible
// row with `repeatedCount` and the original events preserved under `members`.
// ─────────────────────────────────────────────────────────────────────────────

export interface GroupedGovernanceEvent extends GovernanceEvent {
  /** Number of identical events folded into this row (1 = not collapsed). */
  repeatedCount: number;
  /** All underlying events, newest first. Includes the head event. */
  members: GovernanceEvent[];
}

export const REPEAT_GROUP_WINDOW_MS = 5 * 60 * 1000;

function anchorKey(e: GovernanceEvent): string {
  return (
    e.links.matchId ??
    e.links.poiId ??
    e.links.engagementId ??
    e.links.wadId ??
    e.links.paymentReference ??
    e.links.entityId ??
    ""
  );
}

function repeatKey(e: GovernanceEvent): string {
  return [
    e.actorId ?? e.actorType,
    anchorKey(e),
    e.action,
    e.reasonCode ?? "",
    e.status,
  ].join("|");
}

/**
 * Collapse adjacent (newest-first) identical events within the 5-minute
 * window into a single grouped row. Events outside the window or with a
 * different key break the group and start a new one. Stable: never reorders.
 */
export function groupRepeatedEvents(
  events: GovernanceEvent[],
): GroupedGovernanceEvent[] {
  const out: GroupedGovernanceEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && repeatKey(last) === repeatKey(e)) {
      const lastTs = new Date(last.occurredAt).getTime();
      const thisTs = new Date(e.occurredAt).getTime();
      if (Math.abs(lastTs - thisTs) <= REPEAT_GROUP_WINDOW_MS) {
        last.repeatedCount += 1;
        last.members.push(e);
        continue;
      }
    }
    out.push({ ...e, repeatedCount: 1, members: [e] });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic "full story" summary (§38). Never AI, never speculative.
// Documentation status is intentionally excluded (separate scope).
// ─────────────────────────────────────────────────────────────────────────────

export interface FullStoryInputs {
  recordStatus?: string | null;
  poiStatus?: string | null;
  wadStatus?: string | null;
  executionStatus?: "blocked" | "permitted" | "not recorded" | string | null;
  executionReason?: string | null;
  lastEvent?: { action: string; occurredAt: string } | null;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "not recorded";
  }
}

export function buildFullStorySummary(i: FullStoryInputs): string {
  const record = i.recordStatus?.trim() || "not recorded";
  const poi = i.poiStatus?.trim() || "not recorded";
  const wad = i.wadStatus?.trim() || "not recorded";
  const exec = i.executionStatus?.toString().trim() || "not recorded";
  const reason = i.executionReason?.trim() || "not recorded";
  const last = i.lastEvent
    ? `${i.lastEvent.action} on ${fmtDate(i.lastEvent.occurredAt)}`
    : "not recorded";
  return `This record is currently ${record}. POI is ${poi}. WaD is ${wad}. Execution is ${exec} because ${reason}. Last material event was ${last}.`;
}

