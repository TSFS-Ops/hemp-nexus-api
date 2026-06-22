/**
 * Batch 30 — Outreach, Notifications, Operations Queues & Readiness Dashboard
 * Operating Rules SSOT.
 *
 * Mirrored byte-identically at
 *   supabase/functions/_shared/registry-operations-outreach-rules.ts
 * Parity pinned by:
 *   scripts/check-registry-operations-outreach-rules-parity.mjs
 *
 * Encodes client decisions from
 *   docs/registry/Izenzo_Business_Registry_Operating_Rules_Client_Questionnaire_Completed.docx
 * for: AI draft categories + field access + forbidden wording, outreach
 * approval roles, sending modes, do-not-contact, day-one admin queues +
 * owners, SLAs (business days SAST), alert triggers, notification event
 * matrix, readiness-dashboard audience rules, build-vs-data readiness
 * labels, and the WhatsApp/SMS disabled state.
 *
 * Data + pure helpers only. No I/O, no React. Builds on Batches 1–29;
 * never weakens any accepted guardrail (Batch 6/7 outreach + DNC, Batch
 * 15/15B API, Batch 27 authority, Batch 28 bank, Batch 29 API).
 */

// ──────────────────── AI draft categories ────────────────────

export const REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES = [
  "claim_invite",
  "evidence_request",
  "authority_reminder",
  "bank_evidence_reminder",
  "correction_request",
  "dispute_notice",
  "no_result_company_addition_response",
  "api_onboarding_reminder",
  "support_follow_up",
] as const;
export type RegistryOpsAiDraftCategory =
  (typeof REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES)[number];

export const REGISTRY_OPS_AI_DRAFT_ONLY = true;
export const REGISTRY_OPS_AI_MAY_AUTO_SEND = false;
export const REGISTRY_OPS_AI_MAY_APPROVE = false;
export const REGISTRY_OPS_AI_MAY_CHANGE_READINESS = false;
export const REGISTRY_OPS_AI_MAY_VERIFY = false;
export const REGISTRY_OPS_AI_MAY_CLEAR_DISPUTES = false;
export const REGISTRY_OPS_AI_MAY_UNLOCK_WORKFLOWS = false;

export const REGISTRY_OPS_AI_DRAFT_REQUIRED_METADATA = [
  "source_fields_used",
  "draft_category",
  "target_company_or_case",
  "intended_recipient_type",
  "required_approver_role",
  "forbidden_word_scan_result",
] as const;

// ──────────────────── AI field access ────────────────────

export const REGISTRY_OPS_AI_FIELDS_ALLOWED = [
  "company_legal_name",
  "country",
  "public_registration_identifier",
  "public_source_label",
  "case_reference_id",
  "requested_evidence_type",
  "deadline_sla",
  "user_own_submitted_text",
  "approved_status_label",
  "support_contact",
] as const;

export const REGISTRY_OPS_AI_FIELDS_MASKED = [
  "phone",
  "email",
  "bank_identifier",
  "personal_name",
] as const;

export const REGISTRY_OPS_AI_FIELDS_ADMIN_ONLY = [
  "internal_note",
  "risk_flag",
  "compliance_comment",
  "dispute_evidence",
  "reviewer_decision",
] as const;

export const REGISTRY_OPS_AI_FIELDS_BLOCKED = [
  "raw_bank_details",
  "identity_documents",
  "passwords_secrets",
  "unapproved_personal_data",
  "unverified_allegations",
  "provider_credentials",
] as const;

export type AiFieldClassification =
  | "allowed"
  | "masked"
  | "admin_only"
  | "blocked"
  | "unknown";

export function classifyAiField(field: string): AiFieldClassification {
  if ((REGISTRY_OPS_AI_FIELDS_BLOCKED as readonly string[]).includes(field)) return "blocked";
  if ((REGISTRY_OPS_AI_FIELDS_ADMIN_ONLY as readonly string[]).includes(field)) return "admin_only";
  if ((REGISTRY_OPS_AI_FIELDS_MASKED as readonly string[]).includes(field)) return "masked";
  if ((REGISTRY_OPS_AI_FIELDS_ALLOWED as readonly string[]).includes(field)) return "allowed";
  return "unknown";
}

export interface AiDraftGateInput {
  category: string;
  source_fields: readonly string[];
  case_approved_masked_fields: readonly string[];
  draft_text: string;
  do_not_contact_blocks_scope: boolean;
}

export interface AiDraftGateResult {
  allowed: boolean;
  blocking_reasons: string[];
}

export function evaluateAiDraftGate(input: AiDraftGateInput): AiDraftGateResult {
  const reasons: string[] = [];
  if (!REGISTRY_OPS_AI_DRAFT_ONLY) reasons.push("ai_must_be_draft_only");
  if (!(REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES as readonly string[]).includes(input.category)) {
    reasons.push(`category_not_allowed:${input.category}`);
  }
  if (input.do_not_contact_blocks_scope) reasons.push("do_not_contact_in_scope");
  const approvedMasked = new Set(input.case_approved_masked_fields);
  for (const f of input.source_fields) {
    const cls = classifyAiField(f);
    if (cls === "blocked") reasons.push(`blocked_field:${f}`);
    else if (cls === "admin_only") reasons.push(`admin_only_field:${f}`);
    else if (cls === "masked" && !approvedMasked.has(f)) reasons.push(`masked_field_not_approved:${f}`);
    else if (cls === "unknown") reasons.push(`unknown_field:${f}`);
  }
  const forbiddenHit = scanForbiddenWording(input.draft_text);
  for (const hit of forbiddenHit) reasons.push(`forbidden_wording:${hit}`);
  return { allowed: reasons.length === 0, blocking_reasons: reasons };
}

// ──────────────────── AI forbidden wording ────────────────────

export const REGISTRY_OPS_AI_ALWAYS_FORBIDDEN_PHRASES = [
  "guaranteed",
  "approved by izenzo",
  "bank approved",
  "compliant",
  "cleared",
  "trusted",
  "safe",
  "risk-free",
  "we confirm payment details",
  "you are required to transact",
  "sanctions cleared",
] as const;

export const REGISTRY_OPS_AI_CONDITIONAL_FORBIDDEN_PHRASES = [
  "verified",
  "official government registry",
  "partner of",
] as const;

export const REGISTRY_OPS_AI_REQUIRED_SAFE_PHRASES = [
  "Please provide evidence for review",
  "This request does not by itself confirm verification or authority.",
] as const;

export function scanForbiddenWording(text: string): string[] {
  const hits: string[] = [];
  const lower = text.toLowerCase();
  for (const p of REGISTRY_OPS_AI_ALWAYS_FORBIDDEN_PHRASES) {
    if (lower.includes(p)) hits.push(p);
  }
  return hits;
}

// ──────────────────── Outreach approval roles ────────────────────

export const REGISTRY_OPS_OUTREACH_APPROVAL_ROLES = {
  prepare_draft: ["support_user", "platform_admin", "compliance_owner"],
  approve_ordinary: ["platform_admin", "compliance_owner"],
  approve_bank: ["compliance_owner"],
  approve_authority: ["compliance_owner"],
  approve_dispute: ["compliance_owner"],
  approve_adverse: ["compliance_owner"],
  approve_sensitive: ["compliance_owner"],
  approve_legal_compliance: ["compliance_owner"],
  approve_institutional: ["compliance_owner"],
} as const;

export const REGISTRY_OPS_OUTREACH_TWO_PERSON_CATEGORIES = [
  "bank_evidence_reminder",
  "authority_reminder",
  "dispute_notice",
  "do_not_contact_override",
  "api_onboarding_reminder",
  "non_template",
] as const;

export const REGISTRY_OPS_OUTREACH_ONE_PERSON_CATEGORIES = [
  "evidence_request",
] as const;

export interface OutreachApprovalInput {
  category: string;
  is_template: boolean;
  approver_role: string;
  second_approver_role: string | null;
  ai_generated: boolean;
  human_approved: boolean;
}

export function evaluateOutreachApproval(
  input: OutreachApprovalInput,
): { allowed: boolean; blocking_reasons: string[] } {
  const reasons: string[] = [];
  if (input.ai_generated && !input.human_approved) {
    reasons.push("ai_text_requires_human_approval");
  }
  const needsTwo =
    (REGISTRY_OPS_OUTREACH_TWO_PERSON_CATEGORIES as readonly string[]).includes(input.category) ||
    !input.is_template;
  let primaryRoles: readonly string[] = REGISTRY_OPS_OUTREACH_APPROVAL_ROLES.approve_ordinary;
  if (input.category === "bank_evidence_reminder") primaryRoles = REGISTRY_OPS_OUTREACH_APPROVAL_ROLES.approve_bank;
  else if (input.category === "authority_reminder") primaryRoles = REGISTRY_OPS_OUTREACH_APPROVAL_ROLES.approve_authority;
  else if (input.category === "dispute_notice") primaryRoles = REGISTRY_OPS_OUTREACH_APPROVAL_ROLES.approve_dispute;
  else if (input.category === "api_onboarding_reminder") primaryRoles = REGISTRY_OPS_OUTREACH_APPROVAL_ROLES.approve_institutional;
  if (!primaryRoles.includes(input.approver_role)) {
    reasons.push(`approver_role_not_authorised:${input.approver_role}`);
  }
  if (needsTwo) {
    if (!input.second_approver_role) reasons.push("second_approver_required");
    else if (input.second_approver_role === input.approver_role) reasons.push("second_approver_must_be_different");
  }
  return { allowed: reasons.length === 0, blocking_reasons: reasons };
}

// ──────────────────── Sending modes ────────────────────

export const REGISTRY_OPS_SENDING_MODE = "mixed_with_exact_gates" as const;
export const REGISTRY_OPS_WHATSAPP_ENABLED = false;
export const REGISTRY_OPS_SMS_ENABLED = false;
export const REGISTRY_OPS_AI_AUTO_SEND_ENABLED = false;
export const REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_CHANNEL = true;
export const REGISTRY_OPS_REAL_EMAIL_REQUIRES_APPROVED_TEMPLATE = true;
export const REGISTRY_OPS_REAL_EMAIL_REQUIRES_HUMAN_APPROVAL = true;

export const REGISTRY_OPS_OUTREACH_STATUSES = [
  "drafted",
  "approved",
  "sent_email",
  "manual_contact_logged",
  "whatsapp_disabled",
  "sms_disabled",
] as const;
export type RegistryOpsOutreachStatus =
  (typeof REGISTRY_OPS_OUTREACH_STATUSES)[number];

export interface EmailSendGateInput {
  channel_approved: boolean;
  template_approved: boolean;
  human_approved: boolean;
  do_not_contact_blocks_scope: boolean;
}
export function evaluateRealEmailSendGate(
  input: EmailSendGateInput,
): { allowed: boolean; blocking_reasons: string[] } {
  const reasons: string[] = [];
  if (!input.channel_approved) reasons.push("channel_not_approved");
  if (!input.template_approved) reasons.push("template_not_approved");
  if (!input.human_approved) reasons.push("human_approval_missing");
  if (input.do_not_contact_blocks_scope) reasons.push("do_not_contact_in_scope");
  return { allowed: reasons.length === 0, blocking_reasons: reasons };
}

// ──────────────────── Do-not-contact ────────────────────

export const REGISTRY_OPS_DNC_SCOPES = [
  "person",
  "email",
  "phone",
  "company",
  "channel",
] as const;
export type RegistryOpsDncScope = (typeof REGISTRY_OPS_DNC_SCOPES)[number];

export const REGISTRY_OPS_DNC_EFFECTS = [
  "block_ai_draft",
  "block_approval",
  "block_sending",
] as const;

export const REGISTRY_OPS_DNC_ADD_ROLES = [
  "platform_admin",
  "compliance_owner",
  "support_user_with_reason",
] as const;

export const REGISTRY_OPS_DNC_REMOVE_ROLES_REQUIRED = [
  "platform_admin",
  "compliance_owner",
] as const;

export const REGISTRY_OPS_DNC_DEFAULT_EXPIRY = "none" as const;
export const REGISTRY_OPS_DNC_REVIEW_INTERVAL_MONTHS = 12;
export const REGISTRY_OPS_DNC_AUDIT_REQUIRED_FIELDS = [
  "reason",
  "actor",
  "timestamp",
  "scope",
] as const;

export interface DncAddInput {
  actor_role: string;
  reason: string | null;
}
export function evaluateDncAdd(input: DncAddInput): { allowed: boolean; reason: string | null } {
  if (input.actor_role === "support_user") {
    if (!input.reason || !input.reason.trim()) return { allowed: false, reason: "support_user_requires_reason" };
    return { allowed: true, reason: null };
  }
  if (input.actor_role === "platform_admin" || input.actor_role === "compliance_owner") {
    return { allowed: true, reason: null };
  }
  return { allowed: false, reason: "actor_role_not_authorised" };
}

export interface DncRemoveInput {
  approver_roles: readonly string[];
}
export function evaluateDncRemove(input: DncRemoveInput): { allowed: boolean; reason: string | null } {
  const set = new Set(input.approver_roles);
  const missing = REGISTRY_OPS_DNC_REMOVE_ROLES_REQUIRED.filter((r) => !set.has(r));
  if (missing.length > 0) return { allowed: false, reason: `missing_roles:${missing.join(",")}` };
  return { allowed: true, reason: null };
}

// ──────────────────── Day-one admin queue priorities ────────────────────

export const REGISTRY_OPS_QUEUE_PRIORITY_ORDER = [
  { rank: 1, queue: "bank_detail_review", owner_roles: ["compliance_owner", "finance_operations"] },
  { rank: 2, queue: "authority_to_act_review", owner_roles: ["compliance_owner"] },
  { rank: 3, queue: "claim_review", owner_roles: ["data_governance_owner", "platform_admin"] },
  { rank: 4, queue: "data_disputes_corrections", owner_roles: ["data_governance_owner"] },
  { rank: 5, queue: "import_batch_review_quarantine", owner_roles: ["data_governance_owner", "technical_admin"] },
  { rank: 6, queue: "duplicate_review_merge", owner_roles: ["data_governance_owner"] },
  { rank: 7, queue: "api_client_approval", owner_roles: ["platform_admin", "compliance_owner"] },
  { rank: 8, queue: "provider_country_readiness_review", owner_roles: ["data_governance_owner"] },
  { rank: 9, queue: "outreach_approval", owner_roles: ["support_user", "platform_admin"] },
  { rank: 10, queue: "stale_expired_readiness_review", owner_roles: ["data_governance_owner"] },
] as const;
export type RegistryOpsQueueName =
  (typeof REGISTRY_OPS_QUEUE_PRIORITY_ORDER)[number]["queue"];

// ──────────────────── SLAs (business days SAST) ────────────────────

export const REGISTRY_OPS_SLAS_BUSINESS_DAYS = {
  bank_detail_review_initial: 1,
  bank_detail_review_escalated_evidence: 3,
  authority_to_act_review: 2,
  claim_review: 2,
  data_disputes_corrections_triage: 3,
  data_disputes_corrections_resolution: 10,
  import_batch_review: 2,
  duplicate_review: 3,
  api_client_approval: 5,
  provider_country_readiness: 5,
  outreach_approval: 1,
  stale_expired_review: 5,
} as const;

export const REGISTRY_OPS_OVERDUE_AUTO_APPROVE_ENABLED = false;
export const REGISTRY_OPS_OVERDUE_CREATES_ADMIN_ALERT = true;

export interface OverdueEvaluationInput {
  queue: string;
  business_days_open: number;
}
export function evaluateOverdue(
  input: OverdueEvaluationInput,
): { overdue: boolean; sla_days: number | null; auto_approve: boolean; raises_admin_alert: boolean } {
  const map = REGISTRY_OPS_SLAS_BUSINESS_DAYS as unknown as Record<string, number>;
  let sla: number | null = null;
  if (input.queue === "bank_detail_review") sla = map.bank_detail_review_initial;
  else if (input.queue === "authority_to_act_review") sla = map.authority_to_act_review;
  else if (input.queue === "claim_review") sla = map.claim_review;
  else if (input.queue === "data_disputes_corrections") sla = map.data_disputes_corrections_triage;
  else if (input.queue === "import_batch_review_quarantine") sla = map.import_batch_review;
  else if (input.queue === "duplicate_review_merge") sla = map.duplicate_review;
  else if (input.queue === "api_client_approval") sla = map.api_client_approval;
  else if (input.queue === "provider_country_readiness_review") sla = map.provider_country_readiness;
  else if (input.queue === "outreach_approval") sla = map.outreach_approval;
  else if (input.queue === "stale_expired_readiness_review") sla = map.stale_expired_review;
  const overdue = sla !== null && input.business_days_open > sla;
  return {
    overdue,
    sla_days: sla,
    auto_approve: false,
    raises_admin_alert: overdue && REGISTRY_OPS_OVERDUE_CREATES_ADMIN_ALERT,
  };
}

// ──────────────────── Alerts ────────────────────

export const REGISTRY_OPS_ADMIN_ALERTS = [
  "import_failure",
  "duplicate_high_confidence_match",
  "public_api_decision_expiring_14_days",
  "readiness_expired",
  "quota_breach",
  "suspicious_api_use",
  "failed_auth_spike",
  "provider_down",
  "country_provider_pending",
  "no_result_request",
  "correction_submitted",
  "sla_overdue",
] as const;

export const REGISTRY_OPS_COMPLIANCE_ALERTS = [
  "bank_dispute",
  "authority_dispute",
  "third_party_bank_account",
  "sensitive_field_exposure_request",
  "do_not_contact_override",
  "raw_bank_detail_request",
  "payment_status_api_exception",
  "adverse_dispute",
  "suspected_misuse",
] as const;

export const REGISTRY_OPS_COMMERCIAL_ALERTS = [
  "api_client_usage_80_percent",
  "api_client_usage_100_percent",
  "api_client_usage_120_percent",
  "production_access_request",
  "new_institutional_client_pending",
  "billing_credit_threshold",
  "contract_expiry",
] as const;

export const REGISTRY_OPS_ALERT_AUTO_EXTERNAL_SEND_ENABLED = false;

// ──────────────────── Notification event matrix ────────────────────

export const REGISTRY_OPS_NOTIFICATION_CHANNELS = [
  "in_app",
  "email",
  "none",
] as const;
export type RegistryOpsNotificationChannel =
  (typeof REGISTRY_OPS_NOTIFICATION_CHANNELS)[number];

export const REGISTRY_OPS_NOTIFICATION_FUTURE_DISABLED_CHANNELS = [
  "whatsapp",
  "sms",
] as const;

export interface NotificationMatrixEntry {
  event: string;
  channels: readonly RegistryOpsNotificationChannel[];
  audience: readonly string[];
}

export const REGISTRY_OPS_NOTIFICATION_MATRIX: readonly NotificationMatrixEntry[] = [
  { event: "claim_submitted", channels: ["in_app", "email"], audience: ["claimant", "platform_admin"] },
  { event: "claim_approved", channels: ["in_app", "email"], audience: ["claimant"] },
  { event: "claim_rejected", channels: ["in_app", "email"], audience: ["claimant"] },
  { event: "claim_more_evidence_required", channels: ["in_app", "email"], audience: ["claimant"] },
  { event: "authority_submitted", channels: ["in_app", "email"], audience: ["requester", "compliance_owner"] },
  { event: "authority_approved", channels: ["in_app", "email"], audience: ["requester"] },
  { event: "authority_rejected", channels: ["in_app", "email"], audience: ["requester"] },
  { event: "authority_expiring", channels: ["in_app", "email"], audience: ["requester"] },
  { event: "authority_disputed", channels: ["in_app", "email"], audience: ["requester", "compliance_owner"] },
  { event: "bank_details_submitted", channels: ["in_app", "email"], audience: ["authorised_company_user"] },
  { event: "bank_details_reviewed", channels: ["in_app", "email"], audience: ["authorised_company_user"] },
  { event: "bank_details_expired", channels: ["in_app", "email"], audience: ["authorised_company_user"] },
  { event: "bank_details_disputed", channels: ["in_app", "email"], audience: ["authorised_company_user", "compliance_owner"] },
  { event: "bank_details_more_evidence_required", channels: ["in_app", "email"], audience: ["authorised_company_user"] },
  { event: "correction_submitted", channels: ["in_app", "email"], audience: ["submitter", "data_governance_owner"] },
  { event: "correction_resolved", channels: ["in_app", "email"], audience: ["submitter"] },
  { event: "correction_more_info_required", channels: ["in_app", "email"], audience: ["submitter"] },
  { event: "api_key_created", channels: ["in_app", "email"], audience: ["api_client_admin", "platform_admin"] },
  { event: "api_key_expiring", channels: ["in_app", "email"], audience: ["api_client_admin", "platform_admin"] },
  { event: "api_key_suspended", channels: ["in_app", "email"], audience: ["api_client_admin", "platform_admin"] },
  { event: "api_quota_threshold", channels: ["in_app", "email"], audience: ["api_client_admin", "platform_admin"] },
  { event: "api_security_alert", channels: ["in_app", "email"], audience: ["api_client_admin", "platform_admin"] },
  { event: "import_failure", channels: ["in_app", "email"], audience: ["data_governance_owner", "technical_admin"] },
  { event: "provider_down", channels: ["in_app", "email"], audience: ["technical_admin", "platform_admin"] },
  { event: "sla_overdue", channels: ["in_app", "email"], audience: ["queue_owner", "platform_admin"] },
];

export function notificationChannelsFor(event: string): readonly RegistryOpsNotificationChannel[] {
  const e = REGISTRY_OPS_NOTIFICATION_MATRIX.find((m) => m.event === event);
  return e ? e.channels : ["none"];
}

// ──────────────────── WhatsApp / SMS disabled ────────────────────

export const REGISTRY_OPS_WHATSAPP_DISABLED_LABEL = "WhatsApp not configured" as const;
export const REGISTRY_OPS_SMS_DISABLED_LABEL = "SMS not configured" as const;

export const REGISTRY_OPS_WHATSAPP_SMS_ENABLE_REQUIREMENTS = [
  "named_provider_account",
  "approved_templates",
  "consent_opt_out_rules",
  "webhook_configuration",
  "test_evidence",
  "compliance_owner_approval",
  "platform_admin_activation",
  "technical_admin_confirmation",
] as const;

export const REGISTRY_OPS_MANUAL_CONTACT_LOG_REPRESENTS_SMS_OR_WHATSAPP = false;

// ──────────────────── Readiness dashboard audience ────────────────────

export const REGISTRY_OPS_READINESS_AUDIENCES = [
  "internal_admin",
  "company_director_authorised_user",
  "bank_institutional_client",
  "prospect",
  "public",
] as const;
export type RegistryOpsReadinessAudience =
  (typeof REGISTRY_OPS_READINESS_AUDIENCES)[number];

export const REGISTRY_OPS_READINESS_DEFAULT_AUDIENCE = "internal_admin" as const;

export const REGISTRY_OPS_READINESS_EXTERNAL_HIDDEN_FIELDS = [
  "internal_note",
  "risk_comment",
  "source_licence_detail",
  "raw_bank_data",
  "reviewer_name",
] as const;

export interface ReadinessAudienceProjection {
  show_full_blockers: boolean;
  show_admin_notes: boolean;
  show_own_company_summary: boolean;
  show_contract_scope_fields: boolean;
  show_public_labels_only: boolean;
  show_demo_aggregate_only: boolean;
}

export function readinessAudienceProjection(
  audience: RegistryOpsReadinessAudience,
): ReadinessAudienceProjection {
  switch (audience) {
    case "internal_admin":
      return { show_full_blockers: true, show_admin_notes: true, show_own_company_summary: true, show_contract_scope_fields: true, show_public_labels_only: false, show_demo_aggregate_only: false };
    case "company_director_authorised_user":
      return { show_full_blockers: false, show_admin_notes: false, show_own_company_summary: true, show_contract_scope_fields: false, show_public_labels_only: false, show_demo_aggregate_only: false };
    case "bank_institutional_client":
      return { show_full_blockers: false, show_admin_notes: false, show_own_company_summary: false, show_contract_scope_fields: true, show_public_labels_only: false, show_demo_aggregate_only: false };
    case "prospect":
      return { show_full_blockers: false, show_admin_notes: false, show_own_company_summary: false, show_contract_scope_fields: false, show_public_labels_only: false, show_demo_aggregate_only: true };
    case "public":
      return { show_full_blockers: false, show_admin_notes: false, show_own_company_summary: false, show_contract_scope_fields: false, show_public_labels_only: true, show_demo_aggregate_only: false };
  }
}

export function projectReadinessForAudience<T extends Record<string, unknown>>(
  audience: RegistryOpsReadinessAudience,
  raw: T,
): Record<string, unknown> {
  if (audience === "internal_admin") return { ...raw };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if ((REGISTRY_OPS_READINESS_EXTERNAL_HIDDEN_FIELDS as readonly string[]).includes(k)) continue;
    out[k] = v;
  }
  return out;
}

// ──────────────────── Client-safe wording ────────────────────

export const REGISTRY_OPS_CLIENT_SAFE_WORDING = {
  not_independently_verified:
    "This information is sourced from the records shown and has not been independently verified by Izenzo.",
  demo_only:
    "Demo only - shown for controlled demonstration. Not production data or verification.",
  provider_pending:
    "Provider pending - the external provider check is not live or not approved for this record.",
  manual_evidence_reviewed:
    "Manual evidence reviewed - no live provider check is represented.",
  api_not_ready: "Not available for production API output.",
  sms_disabled: "SMS not configured",
  whatsapp_disabled: "WhatsApp not configured",
} as const;

// ──────────────────── Build vs data readiness ────────────────────

export const REGISTRY_OPS_READINESS_SECTIONS = [
  "platform_build_status",
  "country_coverage",
  "source_licence_readiness",
  "dataset_import_readiness",
  "public_search_readiness",
  "claim_workflow_readiness",
  "authority_workflow_readiness",
  "bank_capture_readiness",
  "bank_verification_readiness",
  "provider_integration_readiness",
  "api_sandbox_readiness",
  "api_production_readiness",
  "commercial_billing_readiness",
] as const;

export const REGISTRY_OPS_READINESS_REQUIRED_LABELS = [
  "Built - data/use approval pending",
  "Data loaded - workflow not active",
] as const;

export const REGISTRY_OPS_READINESS_BUILD_VS_DATA_COLLAPSED = false;

// ──────────────────── Audit events ────────────────────

export const REGISTRY_OPS_AUDIT_EVENTS = [
  "registry.ops.ai_draft.created",
  "registry.ops.ai_draft.blocked",
  "registry.ops.ai_draft.approved",
  "registry.ops.outreach.approved",
  "registry.ops.outreach.sent_email",
  "registry.ops.outreach.manual_contact_logged",
  "registry.ops.outreach.whatsapp_disabled_recorded",
  "registry.ops.outreach.sms_disabled_recorded",
  "registry.ops.dnc.added",
  "registry.ops.dnc.removed",
  "registry.ops.dnc.changed",
  "registry.ops.dnc.override_requested",
  "registry.ops.queue.sla_overdue_alert",
  "registry.ops.alert.admin_raised",
  "registry.ops.alert.compliance_raised",
  "registry.ops.alert.commercial_raised",
  "registry.ops.notification.dispatched",
  "registry.ops.notification.suppressed_disabled_channel",
  "registry.ops.readiness.audience_projection",
] as const;

// ──────────────────── Parity fingerprint ────────────────────

export const REGISTRY_OPS_OPERATING_PARITY_FINGERPRINT =
  "batch-30-operations-outreach-notifications-readiness-v1" as const;
