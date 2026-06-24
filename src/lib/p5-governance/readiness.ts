/**
 * P-5 Batch 1 — Stage 2 deterministic readiness engine.
 *
 * Implements the client-approved "worst-outstanding-issue" rule. Checklist
 * counts are returned for visibility only and MUST NEVER override the
 * worst-outstanding-issue result. The engine is pure: same input → same
 * output, no I/O, no clock reads except the `now` argument.
 */
import {
  P5_REASON_CODES,
  type P5ProviderStatus,
  type P5ReasonCode,
  type P5RuleSeverity,
  type P5Status,
} from "./constants";

export type EvidenceState =
  | "missing"
  | "submitted"
  | "approved_internal"
  | "rejected"
  | "expired"
  | "waived";

export interface ReadinessEvidenceItem {
  required: boolean;
  state: EvidenceState;
  expires_at?: string | null;
}

export interface ReadinessProviderItem {
  required: boolean;
  status: P5ProviderStatus;
  high_risk?: boolean;
  /** True when two independent provider results disagree. */
  conflict?: boolean;
}

export interface ReadinessHoldItem {
  kind: "compliance" | "governance" | "operational";
  released: boolean;
}

export interface ReadinessFlag {
  severity: P5RuleSeverity;
  reason: P5ReasonCode;
}

export interface ReadinessApproval {
  /** Required for the transition into `ready_to_proceed`. */
  human_approval_recorded: boolean;
  /** True when an authorised override or waiver has been recorded. */
  override_or_waiver_recorded?: boolean;
}

export interface ReadinessSlaState {
  overdue: boolean;
  disputed?: boolean;
  high_risk_unresolved?: boolean;
}

export interface ReadinessInput {
  evidence: ReadinessEvidenceItem[];
  providers: ReadinessProviderItem[];
  holds: ReadinessHoldItem[];
  flags: ReadinessFlag[];
  approval: ReadinessApproval;
  sla: ReadinessSlaState;
  /** True when reviewer has actively requested correction or more evidence. */
  reviewer_more_info_requested?: boolean;
  /** True when all required internal items have been reviewed at least once. */
  internal_review_complete: boolean;
  /** True when a payment/finality anomaly or audit irregularity is open. */
  payment_or_audit_anomaly?: boolean;
  /** ISO timestamp used for expiry comparisons. Defaults to Date.now(). */
  now?: string;
}

export interface ChecklistCounts {
  required_total: number;
  required_satisfied: number;
  optional_total: number;
  optional_satisfied: number;
  providers_required: number;
  providers_satisfied: number;
}

export interface ReadinessResult {
  status: P5Status;
  reason: P5ReasonCode | null;
  /** Visibility-only. Never used as a tie-breaker against `status`. */
  checklist: ChecklistCounts;
  /** Ordered list of triggers considered, for debugging/audit traces. */
  triggers: Array<{ status: P5Status; reason: P5ReasonCode }>;
}

function isExpired(item: ReadinessEvidenceItem, now: Date): boolean {
  if (!item.expires_at) return false;
  const t = Date.parse(item.expires_at);
  return Number.isFinite(t) && t <= now.getTime();
}

function evidenceSatisfied(item: ReadinessEvidenceItem, now: Date): boolean {
  if (item.state === "approved_internal" || item.state === "waived") {
    return !isExpired(item, now);
  }
  return false;
}

function providerSatisfied(p: ReadinessProviderItem): boolean {
  if (!p.required) return true;
  return p.status === "passed" || p.status === "not_applicable";
}

function computeChecklist(input: ReadinessInput, now: Date): ChecklistCounts {
  let required_total = 0;
  let required_satisfied = 0;
  let optional_total = 0;
  let optional_satisfied = 0;
  for (const e of input.evidence) {
    if (e.required) {
      required_total += 1;
      if (evidenceSatisfied(e, now)) required_satisfied += 1;
    } else {
      optional_total += 1;
      if (evidenceSatisfied(e, now)) optional_satisfied += 1;
    }
  }
  let providers_required = 0;
  let providers_satisfied = 0;
  for (const p of input.providers) {
    if (p.required) {
      providers_required += 1;
      if (providerSatisfied(p)) providers_satisfied += 1;
    }
  }
  return {
    required_total,
    required_satisfied,
    optional_total,
    optional_satisfied,
    providers_required,
    providers_satisfied,
  };
}

/**
 * Worst-outstanding-issue engine. Order matters: each `if` represents a more
 * severe outcome than the ones below. The first match wins.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const now = input.now ? new Date(input.now) : new Date();
  const checklist = computeChecklist(input, now);
  const triggers: ReadinessResult["triggers"] = [];

  const record = (status: P5Status, reason: P5ReasonCode) => {
    triggers.push({ status, reason });
    return { status, reason, checklist, triggers };
  };

  // 1. Hard blockers / anomalies → blocked
  const hardBlocker = input.flags.find((f) => f.severity === "hard_blocker");
  if (hardBlocker) return record("blocked", hardBlocker.reason);

  if (input.payment_or_audit_anomaly) {
    return record("blocked", "audit_trail_issue");
  }

  const rejectedRequired = input.evidence.find(
    (e) => e.required && e.state === "rejected",
  );
  if (rejectedRequired) return record("blocked", "rejected_by_reviewer");

  const failedHighRiskProvider = input.providers.find(
    (p) => p.required && p.status === "failed" && p.high_risk,
  );
  if (failedHighRiskProvider) {
    return record("blocked", "sanctions_pep_adverse_result_review");
  }

  // 2. Holds (unreleased) → on_hold
  const openHold = input.holds.find((h) => !h.released);
  if (openHold) {
    const reason: P5ReasonCode =
      openHold.kind === "governance"
        ? "governance_hold_applied"
        : "compliance_hold_applied";
    return record("on_hold", reason);
  }

  // 3. SLA / dispute / unresolved high risk → escalated
  if (input.sla.overdue) return record("escalated", "overdue_sla");
  if (input.sla.disputed) return record("escalated", "disputed_decision");
  if (input.sla.high_risk_unresolved) {
    return record("escalated", "high_risk_escalation");
  }

  // 4. Reviewer requested correction → more_information_required
  if (input.reviewer_more_info_requested) {
    return record("more_information_required", "manual_review_required");
  }

  // 5. Required evidence missing/incomplete/expired → incomplete
  const missingRequired = input.evidence.find(
    (e) => e.required && (e.state === "missing" || e.state === "submitted"),
  );
  const expiredRequired = input.evidence.find(
    (e) => e.required && (e.state === "expired" || isExpired(e, now)),
  );
  if (expiredRequired) return record("incomplete", "expired_evidence");
  if (missingRequired) {
    const reason: P5ReasonCode =
      missingRequired.state === "submitted"
        ? "manual_review_required"
        : "missing_evidence";
    const status: P5Status =
      missingRequired.state === "submitted" ? "submitted" : "incomplete";
    return record(status, reason);
  }

  // 6. Internal review not yet complete → under_review
  if (!input.internal_review_complete) {
    return record("under_review", "manual_review_required");
  }

  // 7. Provider conflict → escalated (treated as unresolved high risk)
  const providerConflict = input.providers.find((p) => p.required && p.conflict);
  if (providerConflict) return record("escalated", "provider_result_conflict");

  // 8. Provider failures (non-high-risk) → blocked
  const failedProvider = input.providers.find(
    (p) => p.required && p.status === "failed",
  );
  if (failedProvider) return record("blocked", "provider_failed");

  // 9. Provider dependency not satisfied → provider_dependent
  const providerNotLive = input.providers.find(
    (p) => p.required && p.status === "not_live",
  );
  if (providerNotLive) return record("provider_dependent", "provider_not_live");

  const providerCredsPending = input.providers.find(
    (p) => p.required && p.status === "credentials_pending",
  );
  if (providerCredsPending) {
    return record("provider_dependent", "provider_credentials_pending");
  }

  const providerTimeout = input.providers.find(
    (p) => p.required && p.status === "timeout",
  );
  if (providerTimeout) return record("provider_dependent", "provider_timeout");

  const providerInconclusive = input.providers.find(
    (p) => p.required && p.status === "inconclusive",
  );
  if (providerInconclusive) {
    return record("provider_dependent", "provider_inconclusive");
  }

  const providerPending = input.providers.find(
    (p) => p.required && p.status === "pending",
  );
  if (providerPending) return record("provider_dependent", "provider_pending");

  // 10. Only warnings or approved waivers/overrides left → conditional_ready
  const hasWarning = input.flags.some((f) => f.severity === "warning");
  const hasWaivedEvidence = input.evidence.some((e) => e.state === "waived");
  if (
    hasWarning ||
    hasWaivedEvidence ||
    input.approval.override_or_waiver_recorded
  ) {
    if (!input.approval.human_approval_recorded) {
      return record("conditional_ready", "waiver_granted");
    }
    return record("conditional_ready", "waiver_granted");
  }

  // 11. All internal + provider checks satisfied. Need human approval to ship.
  if (!input.approval.human_approval_recorded) {
    return record("internally_ready", "approved_by_reviewer");
  }

  return record("ready_to_proceed", "approved_by_admin");
}

/** Type guard helper for callers persisting reason codes. */
export function isP5ReasonCode(value: string): value is P5ReasonCode {
  return (P5_REASON_CODES as readonly string[]).includes(value);
}
