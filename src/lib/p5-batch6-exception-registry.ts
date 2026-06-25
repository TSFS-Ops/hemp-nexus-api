/**
 * P-5 Batch 6 — Exceptions, Review Queues and Audit
 * Phase 1: Single Source of Truth (SSOT) registry.
 *
 * Closed vocabularies for exception types, review queues, priorities,
 * statuses, dispute states, note types, audit events, reports and
 * external wording. Every Batch 6 UI / RPC / test / drift guard MUST
 * import from this file.
 *
 * This module is data-only — no runtime logic, no DB calls. Phases 2–6
 * (DB, RPCs, projection, UI, QA) will be built on top of these constants
 * in separate apply batches.
 *
 * Cross-batch contracts:
 *   - Finality + Memory governance owned by Batch 5 (p5_batch4_finality_records,
 *     p5_batch5_memory_records). Batch 6 references Batch 5 status semantics
 *     but does not redefine finality/Memory state.
 *   - C6.2 cron correlation hardening remains pending — Batch 6 must not
 *     introduce pg_cron jobs or scheduled sweeps.
 */

export const P5_BATCH6_SCHEMA_VERSION = "p5b6.v1" as const;

// ────────────────────────────────────────────────────────────────────────────
// 1. Exception types (12, client-approved)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_EXCEPTION_TYPES = [
  "EVIDENCE_MISSING",
  "EVIDENCE_INVALID_OR_EXPIRED",
  "CONFLICTING_PARTY_INFORMATION",
  "COMPLIANCE_HOLD",
  "FUNDER_REVIEW_EXCEPTION",
  "PROVIDER_DEPENDENCY_FAILURE",
  "PAYMENT_RECONCILIATION_EXCEPTION",
  "MANUAL_OVERRIDE_REQUESTED",
  "DISPUTE_RAISED",
  "FINALITY_BLOCKED",
  "MEMORY_CONFLICT_OR_CORRECTION",
  "SECURITY_OR_ACCESS_EXCEPTION",
] as const;

export type P5Batch6ExceptionType = (typeof P5_BATCH6_EXCEPTION_TYPES)[number];

export interface P5Batch6ExceptionTypeDefinition {
  readonly code: P5Batch6ExceptionType;
  readonly label: string;
  readonly default_owner_role: string;
  readonly default_queue: P5Batch6ReviewQueue;
  readonly default_status: P5Batch6Status;
  readonly default_severity: "critical" | "high" | "medium";
  readonly can_block_finality: boolean;
  readonly can_pause_memory: boolean;
  readonly authorised_resolver_roles: ReadonlyArray<string>;
}

export const P5_BATCH6_EXCEPTION_DEFINITIONS: Readonly<
  Record<P5Batch6ExceptionType, P5Batch6ExceptionTypeDefinition>
> = {
  EVIDENCE_MISSING: {
    code: "EVIDENCE_MISSING",
    label: "Evidence missing",
    default_owner_role: "evidence_review_admin",
    default_queue: "evidence_gap",
    default_status: "open_action_required",
    default_severity: "high",
    can_block_finality: true,
    can_pause_memory: false,
    authorised_resolver_roles: ["evidence_review_admin", "platform_admin"],
  },
  EVIDENCE_INVALID_OR_EXPIRED: {
    code: "EVIDENCE_INVALID_OR_EXPIRED",
    label: "Evidence invalid or expired",
    default_owner_role: "evidence_review_admin",
    default_queue: "evidence_gap",
    default_status: "open_evidence_review",
    default_severity: "high",
    can_block_finality: true,
    can_pause_memory: false,
    authorised_resolver_roles: ["evidence_review_admin", "compliance_admin"],
  },
  CONFLICTING_PARTY_INFORMATION: {
    code: "CONFLICTING_PARTY_INFORMATION",
    label: "Conflicting party information",
    default_owner_role: "compliance_admin",
    default_queue: "compliance_exception",
    default_status: "open_compliance_review",
    default_severity: "high",
    can_block_finality: true,
    can_pause_memory: true,
    authorised_resolver_roles: ["compliance_admin"],
  },
  COMPLIANCE_HOLD: {
    code: "COMPLIANCE_HOLD",
    label: "Compliance hold",
    default_owner_role: "compliance_admin",
    default_queue: "compliance_exception",
    default_status: "on_hold_compliance",
    default_severity: "critical",
    can_block_finality: true,
    can_pause_memory: true,
    authorised_resolver_roles: ["compliance_admin", "platform_super_admin"],
  },
  FUNDER_REVIEW_EXCEPTION: {
    code: "FUNDER_REVIEW_EXCEPTION",
    label: "Funder review exception",
    default_owner_role: "funder_review_owner",
    default_queue: "funder_escalation",
    default_status: "open_funder_review",
    default_severity: "high",
    can_block_finality: true,
    can_pause_memory: false,
    authorised_resolver_roles: ["funder_review_owner", "platform_admin"],
  },
  PROVIDER_DEPENDENCY_FAILURE: {
    code: "PROVIDER_DEPENDENCY_FAILURE",
    label: "Provider dependency failure",
    default_owner_role: "platform_operations_admin",
    default_queue: "provider_dependency",
    default_status: "open_provider_dependency",
    default_severity: "critical",
    can_block_finality: true,
    can_pause_memory: false,
    authorised_resolver_roles: ["platform_operations_admin"],
  },
  PAYMENT_RECONCILIATION_EXCEPTION: {
    code: "PAYMENT_RECONCILIATION_EXCEPTION",
    label: "Payment reconciliation exception",
    default_owner_role: "payments_admin",
    default_queue: "payment_reconciliation",
    default_status: "open_reconciliation",
    default_severity: "critical",
    can_block_finality: true,
    can_pause_memory: false,
    authorised_resolver_roles: ["payments_admin"],
  },
  MANUAL_OVERRIDE_REQUESTED: {
    code: "MANUAL_OVERRIDE_REQUESTED",
    label: "Manual override requested",
    default_owner_role: "platform_admin",
    default_queue: "manual_override_waiver",
    default_status: "pending_override_approval",
    default_severity: "high",
    can_block_finality: true,
    can_pause_memory: true,
    authorised_resolver_roles: ["platform_super_admin", "compliance_admin"],
  },
  DISPUTE_RAISED: {
    code: "DISPUTE_RAISED",
    label: "Dispute raised",
    default_owner_role: "dispute_review_admin",
    default_queue: "dispute_review",
    default_status: "dispute_raised",
    default_severity: "critical",
    can_block_finality: true,
    can_pause_memory: true,
    authorised_resolver_roles: ["compliance_admin", "platform_super_admin"],
  },
  FINALITY_BLOCKED: {
    code: "FINALITY_BLOCKED",
    label: "Finality blocked",
    default_owner_role: "finality_review_admin",
    default_queue: "finality_review",
    default_status: "blocked_finality",
    default_severity: "critical",
    can_block_finality: true,
    can_pause_memory: false,
    authorised_resolver_roles: ["finality_review_admin", "platform_super_admin"],
  },
  MEMORY_CONFLICT_OR_CORRECTION: {
    code: "MEMORY_CONFLICT_OR_CORRECTION",
    label: "Memory conflict or correction",
    default_owner_role: "memory_governance_admin",
    default_queue: "memory_governance",
    default_status: "open_memory_review",
    default_severity: "high",
    can_block_finality: false,
    can_pause_memory: true,
    authorised_resolver_roles: ["compliance_admin", "platform_super_admin"],
  },
  SECURITY_OR_ACCESS_EXCEPTION: {
    code: "SECURITY_OR_ACCESS_EXCEPTION",
    label: "Security or access exception",
    default_owner_role: "platform_security_admin",
    default_queue: "compliance_exception",
    default_status: "security_hold",
    default_severity: "critical",
    can_block_finality: true,
    can_pause_memory: true,
    authorised_resolver_roles: ["platform_security_admin"],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 2. Review queues (10, including Unified Operations Inbox)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_REVIEW_QUEUES = [
  "evidence_gap",
  "compliance_exception",
  "funder_escalation",
  "provider_dependency",
  "payment_reconciliation",
  "manual_override_waiver",
  "finality_review",
  "dispute_review",
  "memory_governance",
  "unified_operations_inbox",
] as const;

export type P5Batch6ReviewQueue = (typeof P5_BATCH6_REVIEW_QUEUES)[number];

export interface P5Batch6QueueDefinition {
  readonly code: P5Batch6ReviewQueue;
  readonly label: string;
  readonly owner_role: string;
  readonly triage_target_working_days: number;
  readonly resolution_target_working_days: number;
  readonly is_control_tower: boolean;
}

export const P5_BATCH6_QUEUE_DEFINITIONS: Readonly<
  Record<P5Batch6ReviewQueue, P5Batch6QueueDefinition>
> = {
  evidence_gap: {
    code: "evidence_gap",
    label: "Evidence Gap Queue",
    owner_role: "evidence_review_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 2,
    is_control_tower: false,
  },
  compliance_exception: {
    code: "compliance_exception",
    label: "Compliance Exception Queue",
    owner_role: "compliance_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 2,
    is_control_tower: false,
  },
  funder_escalation: {
    code: "funder_escalation",
    label: "Funder Escalation Queue",
    owner_role: "funder_review_owner",
    triage_target_working_days: 1,
    resolution_target_working_days: 3,
    is_control_tower: false,
  },
  provider_dependency: {
    code: "provider_dependency",
    label: "Provider Dependency Queue",
    owner_role: "platform_operations_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 1,
    is_control_tower: false,
  },
  payment_reconciliation: {
    code: "payment_reconciliation",
    label: "Payment and Reconciliation Queue",
    owner_role: "payments_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 1,
    is_control_tower: false,
  },
  manual_override_waiver: {
    code: "manual_override_waiver",
    label: "Manual Override and Waiver Queue",
    owner_role: "platform_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 2,
    is_control_tower: false,
  },
  finality_review: {
    code: "finality_review",
    label: "Finality Review Queue",
    owner_role: "finality_review_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 1,
    is_control_tower: false,
  },
  dispute_review: {
    code: "dispute_review",
    label: "Dispute Review Queue",
    owner_role: "dispute_review_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 5,
    is_control_tower: false,
  },
  memory_governance: {
    code: "memory_governance",
    label: "Memory Governance Queue",
    owner_role: "memory_governance_admin",
    triage_target_working_days: 1,
    resolution_target_working_days: 2,
    is_control_tower: false,
  },
  unified_operations_inbox: {
    code: "unified_operations_inbox",
    label: "Unified Operations Inbox",
    owner_role: "platform_admin",
    triage_target_working_days: 0,
    resolution_target_working_days: 0,
    is_control_tower: true,
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 3. Priorities (P0–P4)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_PRIORITIES = ["P0", "P1", "P2", "P3", "P4"] as const;
export type P5Batch6Priority = (typeof P5_BATCH6_PRIORITIES)[number];

export interface P5Batch6PriorityDefinition {
  readonly code: P5Batch6Priority;
  readonly label: string;
  readonly sort_order: number; // lower = higher visual priority
  readonly escalate_after_working_hours: number;
  readonly downgrade_requires_approval: boolean;
}

export const P5_BATCH6_PRIORITY_DEFINITIONS: Readonly<
  Record<P5Batch6Priority, P5Batch6PriorityDefinition>
> = {
  P0: { code: "P0", label: "Critical Blocker", sort_order: 0, escalate_after_working_hours: 4, downgrade_requires_approval: true },
  P1: { code: "P1", label: "High", sort_order: 1, escalate_after_working_hours: 8, downgrade_requires_approval: true },
  P2: { code: "P2", label: "Medium", sort_order: 2, escalate_after_working_hours: 24, downgrade_requires_approval: false },
  P3: { code: "P3", label: "Low", sort_order: 3, escalate_after_working_hours: 40, downgrade_requires_approval: false },
  P4: { code: "P4", label: "Monitor Only", sort_order: 4, escalate_after_working_hours: 9999, downgrade_requires_approval: false },
};

// ────────────────────────────────────────────────────────────────────────────
// 4. Statuses (controlled lifecycle)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_STATUSES = [
  "open_action_required",
  "open_evidence_review",
  "open_compliance_review",
  "on_hold_compliance",
  "open_funder_review",
  "open_provider_dependency",
  "open_reconciliation",
  "pending_override_approval",
  "dispute_raised",
  "blocked_finality",
  "open_memory_review",
  "security_hold",
  "under_review",
  "awaiting_evidence",
  "awaiting_external_response",
  "resolved",
  "reopened",
  "duplicate",
  "cancelled",
  "invalid_test",
  "tombstoned_legal",
] as const;

export type P5Batch6Status = (typeof P5_BATCH6_STATUSES)[number];

/** Statuses that mean the exception is no longer active in the inbox. */
export const P5_BATCH6_TERMINAL_STATUSES: ReadonlyArray<P5Batch6Status> = [
  "resolved",
  "duplicate",
  "cancelled",
  "invalid_test",
  "tombstoned_legal",
];

// ────────────────────────────────────────────────────────────────────────────
// 5. Dispute states (13)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_DISPUTE_STATES = [
  "dispute_raised",
  "initial_triage",
  "under_review",
  "awaiting_evidence",
  "awaiting_counterparty_response",
  "escalated",
  "proposed_resolution",
  "resolved_upheld",
  "resolved_partially_upheld",
  "resolved_dismissed",
  "withdrawn",
  "closed_corrected",
  "closed_superseded",
] as const;

export type P5Batch6DisputeState = (typeof P5_BATCH6_DISPUTE_STATES)[number];

/** Dispute states where Memory reuse must remain paused. */
export const P5_BATCH6_DISPUTE_STATES_PAUSE_MEMORY: ReadonlyArray<P5Batch6DisputeState> = [
  "dispute_raised",
  "initial_triage",
  "under_review",
  "awaiting_evidence",
  "awaiting_counterparty_response",
  "escalated",
  "proposed_resolution",
];

// ────────────────────────────────────────────────────────────────────────────
// 6. Note types (10, all immutable after save)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_NOTE_TYPES = [
  "resolution_reason",
  "override_waiver_reason",
  "rejection_reason",
  "compliance_hold_note",
  "priority_change_reason",
  "assignment_note",
  "evidence_request_note",
  "dispute_review_note",
  "correction_supersession_note",
  "security_access_note",
] as const;

export type P5Batch6NoteType = (typeof P5_BATCH6_NOTE_TYPES)[number];

/** Note types where reason is mandatory at the action that creates them. */
export const P5_BATCH6_NOTE_TYPES_REQUIRE_REASON: ReadonlyArray<P5Batch6NoteType> = [
  "resolution_reason",
  "override_waiver_reason",
  "rejection_reason",
  "compliance_hold_note",
  "priority_change_reason",
  "evidence_request_note",
  "dispute_review_note",
  "correction_supersession_note",
  "security_access_note",
];

// ────────────────────────────────────────────────────────────────────────────
// 7. Audit events (all use p5b6.* prefix, append-only)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_AUDIT_EVENTS = [
  "p5b6.exception.created",
  "p5b6.exception.assigned",
  "p5b6.exception.reassigned",
  "p5b6.exception.comment_added",
  "p5b6.exception.note_added",
  "p5b6.exception.status_changed",
  "p5b6.exception.priority_changed",
  "p5b6.exception.severity_changed",
  "p5b6.exception.escalated",
  "p5b6.exception.sla_breached",
  "p5b6.exception.resolved",
  "p5b6.exception.reopened",
  "p5b6.exception.marked_duplicate",
  "p5b6.exception.marked_cancelled",
  "p5b6.exception.marked_invalid_test",
  "p5b6.exception.tombstone_legal_redaction",
  "p5b6.evidence.requested",
  "p5b6.evidence.uploaded",
  "p5b6.evidence.accepted",
  "p5b6.evidence.rejected",
  "p5b6.evidence.waived",
  "p5b6.override.requested",
  "p5b6.override.approved",
  "p5b6.override.rejected",
  "p5b6.provider.retry_attempted",
  "p5b6.provider.failure_recorded",
  "p5b6.provider.recovered",
  "p5b6.provider.manual_workaround_approved",
  "p5b6.payment.reconciled",
  "p5b6.payment.refund_recorded",
  "p5b6.payment.chargeback_recorded",
  "p5b6.payment.duplicate_notification_recorded",
  "p5b6.dispute.raised",
  "p5b6.dispute.state_changed",
  "p5b6.dispute.resolved",
  "p5b6.finality.blocked",
  "p5b6.finality.unblocked",
  "p5b6.finality.under_dispute_marked",
  "p5b6.finality.dispute_cleared",
  "p5b6.memory.reuse_paused",
  "p5b6.memory.reuse_resumed",
  "p5b6.memory.correction_recorded",
  "p5b6.memory.exclusion_recorded",
  "p5b6.notification.sent",
  "p5b6.notification.suppressed_grouped",
  "p5b6.export.report_generated",
  "p5b6.export.report_downloaded",
  "p5b6.api.safe_status_read",
  "p5b6.access.unauthorised_attempt_blocked",
] as const;

export type P5Batch6AuditEvent = (typeof P5_BATCH6_AUDIT_EVENTS)[number];

/** Audit events where before_state + after_state are mandatory. */
export const P5_BATCH6_AUDIT_EVENTS_REQUIRE_BEFORE_AFTER: ReadonlyArray<P5Batch6AuditEvent> = [
  "p5b6.exception.status_changed",
  "p5b6.exception.priority_changed",
  "p5b6.exception.severity_changed",
  "p5b6.evidence.accepted",
  "p5b6.evidence.rejected",
  "p5b6.evidence.waived",
  "p5b6.override.approved",
  "p5b6.override.rejected",
  "p5b6.provider.recovered",
  "p5b6.payment.reconciled",
  "p5b6.dispute.state_changed",
  "p5b6.dispute.resolved",
  "p5b6.finality.under_dispute_marked",
  "p5b6.finality.dispute_cleared",
  "p5b6.memory.correction_recorded",
  "p5b6.memory.exclusion_recorded",
  "p5b6.exception.tombstone_legal_redaction",
];

// ────────────────────────────────────────────────────────────────────────────
// 8. Reports (13)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_REPORTS = [
  "open_exceptions",
  "overdue_sla",
  "critical_blockers",
  "evidence_gap",
  "compliance_hold_and_waiver",
  "manual_override_waiver",
  "dispute",
  "provider_dependency_incident",
  "payment_reconciliation_exception",
  "finality_blocker",
  "memory_review_and_correction",
  "audit_export",
  "exception_trend",
] as const;

export type P5Batch6Report = (typeof P5_BATCH6_REPORTS)[number];

export interface P5Batch6ReportDefinition {
  readonly code: P5Batch6Report;
  readonly label: string;
  readonly export_formats: ReadonlyArray<"csv" | "xlsx" | "pdf" | "json">;
  readonly restricted: boolean; // restricted = compliance / audit roles only
  readonly emits_audit_event: true; // every export MUST emit p5b6.export.* event
}

export const P5_BATCH6_REPORT_DEFINITIONS: Readonly<
  Record<P5Batch6Report, P5Batch6ReportDefinition>
> = {
  open_exceptions:                 { code: "open_exceptions",                 label: "Open Exceptions Report",                  export_formats: ["csv","xlsx","pdf"], restricted: false, emits_audit_event: true },
  overdue_sla:                     { code: "overdue_sla",                     label: "Overdue Review/SLA Report",               export_formats: ["csv","xlsx","pdf"], restricted: false, emits_audit_event: true },
  critical_blockers:               { code: "critical_blockers",               label: "Critical Blockers Report",                export_formats: ["xlsx","pdf"],       restricted: false, emits_audit_event: true },
  evidence_gap:                    { code: "evidence_gap",                    label: "Evidence Gap Report",                     export_formats: ["csv","xlsx","pdf"], restricted: false, emits_audit_event: true },
  compliance_hold_and_waiver:      { code: "compliance_hold_and_waiver",      label: "Compliance Hold and Waiver Report",       export_formats: ["xlsx","pdf"],       restricted: true,  emits_audit_event: true },
  manual_override_waiver:          { code: "manual_override_waiver",          label: "Manual Override/Waiver Report",           export_formats: ["xlsx","pdf"],       restricted: true,  emits_audit_event: true },
  dispute:                         { code: "dispute",                         label: "Dispute Report",                          export_formats: ["xlsx","pdf"],       restricted: true,  emits_audit_event: true },
  provider_dependency_incident:    { code: "provider_dependency_incident",    label: "Provider Dependency and Incident Report", export_formats: ["csv","xlsx","pdf"], restricted: false, emits_audit_event: true },
  payment_reconciliation_exception:{ code: "payment_reconciliation_exception",label: "Payment Reconciliation Exception Report", export_formats: ["xlsx","pdf"],       restricted: true,  emits_audit_event: true },
  finality_blocker:                { code: "finality_blocker",                label: "Finality Blocker Report",                 export_formats: ["csv","xlsx","pdf"], restricted: false, emits_audit_event: true },
  memory_review_and_correction:    { code: "memory_review_and_correction",    label: "Memory Review and Correction Report",     export_formats: ["xlsx","pdf"],       restricted: true,  emits_audit_event: true },
  audit_export:                    { code: "audit_export",                    label: "Audit Export Report",                     export_formats: ["csv","xlsx","pdf","json"], restricted: true, emits_audit_event: true },
  exception_trend:                 { code: "exception_trend",                 label: "Exception Trend Report",                  export_formats: ["xlsx","pdf"],       restricted: false, emits_audit_event: true },
};

// ────────────────────────────────────────────────────────────────────────────
// 9. External-safe messages + banned external wording
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_EXTERNAL_SAFE_MESSAGES = {
  ACTION_REQUIRED_EVIDENCE: "Action required: required evidence is missing.",
  UNDER_REVIEW_COMPLIANCE:  "Under review: compliance review in progress.",
  TEMPORARILY_BLOCKED_PROVIDER: "Temporarily blocked: provider verification is unavailable.",
  UNDER_DISPUTE: "Under dispute: reliance is paused while review is completed.",
  RESOLVED: "Resolved: review completed.",
} as const;

export type P5Batch6ExternalSafeMessageKey = keyof typeof P5_BATCH6_EXTERNAL_SAFE_MESSAGES;

/**
 * Phrases that MUST NOT appear in any external-facing surface (organisation,
 * counterparty, funder, API client, support). Enforced by
 * scripts/check-p5-batch6-exception-consistency.mjs.
 */
export const P5_BATCH6_BANNED_EXTERNAL_WORDING = [
  "fraud",
  "fraudulent",
  "suspicious",
  "sanctions hit",
  "pep match",
  "adverse-media match",
  "adverse media match",
  "blacklist",
  "blacklisted",
  "internal risk",
  "manual bypass",
  "compliance failure",
  "criminal",
  "money laundering",
  "watchlist hit",
] as const;

export type P5Batch6BannedExternalWord =
  (typeof P5_BATCH6_BANNED_EXTERNAL_WORDING)[number];

// ────────────────────────────────────────────────────────────────────────────
// 10. API-safe projection allowlist (Phase 4 will enforce; declared here)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_API_SAFE_FIELDS = [
  "exception_status",
  "exception_category_safe",
  "action_required",
  "blocked",
  "due_date",
  "finality_reliance_status",
  "dispute_status",
  "retry_after",
  "error_code",
  "safe_message",
  "next_action",
  "case_reference",
  "updated_at",
  "schema_version",
] as const;

export type P5Batch6ApiSafeField = (typeof P5_BATCH6_API_SAFE_FIELDS)[number];

export const P5_BATCH6_API_SAFE_STATUSES = [
  "clear",
  "exception_open",
  "action_required",
  "under_review",
  "blocked",
  "provider_pending",
  "reconciliation_pending",
  "dispute_open",
  "finality_under_dispute",
  "finality_blocked",
  "resolved",
  "reliance_paused",
  "reliance_available",
] as const;

export type P5Batch6ApiSafeStatus = (typeof P5_BATCH6_API_SAFE_STATUSES)[number];

// ────────────────────────────────────────────────────────────────────────────
// 11. Forbidden fields — never projected into external/API surfaces
// (mirrors Batch 5 forbidden set; Phase 4 stripper will enforce)
// ────────────────────────────────────────────────────────────────────────────

export const P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS = [
  "raw_provider_payload",
  "raw_payload",
  "provider_raw",
  "raw_bank_details",
  "bank_account_number",
  "iban",
  "swift",
  "api_key",
  "api_secret",
  "secret",
  "private_key",
  "access_token",
  "webhook_secret",
  "internal_notes",
  "private_notes",
  "support_notes",
  "internal_risk_notes",
  "funder_private_commentary",
  "draft_ai_suggestion",
  "rejected_document_contents",
  "security_incident_detail",
] as const;

export type P5Batch6ForbiddenExternalField =
  (typeof P5_BATCH6_FORBIDDEN_EXTERNAL_FIELDS)[number];
