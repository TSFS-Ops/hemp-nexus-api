/**
 * Phase 2 — Facilitation Outreach SSOT (browser mirror).
 *
 * Shared status / type / gate-result vocabularies for the Phase 2
 * approved-email-outreach + DNC + compliance-escalation surfaces.
 *
 * Mirror of supabase/functions/_shared/facilitation-outreach-constants.ts —
 * both files are pinned by scripts/check-facilitation-outreach-drift.mjs.
 *
 * NO send-path, NO UI, NO POI/WaD/match/token/credit/payment mutation
 * is implemented yet. This file is vocabulary only.
 */

export const TEMPLATE_STATUSES = [
  "draft",
  "approved",
  "archived",
] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export const CANDIDATE_STATUSES = [
  "proposed",
  "approved_for_contact",
  "blocked_dnc",
  "blocked_duplicate",
  "blocked_compliance",
  "withdrawn",
] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const SEND_STATUSES = [
  "pending",
  "sent",
  "failed",
  "suppressed",
  "cancelled",
] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

export const OUTREACH_STATES = [
  "not_started",
  "ready_to_send",
  "sent",
  "responded",
  "declined",
  "no_response",
  "withdrawn",
] as const;
export type OutreachState = (typeof OUTREACH_STATES)[number];

export const DNC_RULE_TYPES = [
  "email",
  "email_domain",
  "org_name",
] as const;
export type DncRuleType = (typeof DNC_RULE_TYPES)[number];

export const DNC_RULE_STATUSES = [
  "active",
  "revoked",
] as const;
export type DncRuleStatus = (typeof DNC_RULE_STATUSES)[number];

export const DNC_RULE_SEVERITIES = [
  "block",
  "warn",
] as const;
export type DncRuleSeverity = (typeof DNC_RULE_SEVERITIES)[number];

export const ESCALATION_STATUSES = [
  "open",
  "resolved",
] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const DUPLICATE_GATE_STATUSES = [
  "no_duplicate",
  "duplicate_exact_registry_id",
  "duplicate_verified_domain",
  "duplicate_soft_name_match",
] as const;
export type DuplicateGateStatus = (typeof DUPLICATE_GATE_STATUSES)[number];

export const GATE_RESULTS = [
  "allow",
  "warn",
  "block",
] as const;
export type GateResult = (typeof GATE_RESULTS)[number];

/** Canonical Phase 2 reason codes surfaced by the gate resolver. */
export const GATE_REASON_CODES = [
  "dnc_email_block",
  "dnc_domain_block",
  "dnc_org_name_warning",
  "duplicate_exact_registry_id",
  "duplicate_verified_domain",
  "duplicate_soft_name_match",
  "suppression_active",
  "compliance_escalation_open",
] as const;
export type GateReasonCode = (typeof GATE_REASON_CODES)[number];

/** Severity each reason code carries when present. */
export const GATE_REASON_SEVERITY: Record<GateReasonCode, GateResult> = {
  dnc_email_block: "block",
  dnc_domain_block: "block",
  dnc_org_name_warning: "warn",
  duplicate_exact_registry_id: "block",
  duplicate_verified_domain: "block",
  duplicate_soft_name_match: "warn",
  suppression_active: "block",
  compliance_escalation_open: "block",
} as const;
