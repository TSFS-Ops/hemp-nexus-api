/**
 * Phase 2 — Outreach Gate Resolver (pure, server SSOT).
 *
 * Mirror of src/lib/facilitation-outreach-gate.ts —
 * both files are pinned by scripts/check-facilitation-outreach-drift.mjs.
 *
 * Pure function. No DB, no send-path, no POI/WaD/match/token/credit/
 * payment mutation. Callers (future edge functions) pre-fetch inputs
 * and pass them in.
 */

import {
  type DncRuleType,
  type DuplicateGateStatus,
  type GateResult,
  type GateReasonCode,
  GATE_REASON_SEVERITY,
} from "./facilitation-outreach-constants.ts";

export interface DncRuleSnapshot {
  rule_type: DncRuleType;
  value: string;
  status: "active" | "revoked";
  severity: "block" | "warn";
}

export interface OutreachGateInput {
  candidate: {
    contact_email: string | null;
    counterparty_org_name: string | null;
  };
  dnc_rules: readonly DncRuleSnapshot[];
  duplicate_status: DuplicateGateStatus;
  suppression_active: boolean;
  compliance_escalation_open: boolean;
}

export interface OutreachGateDecision {
  result: GateResult;
  reasons: readonly GateReasonCode[];
}

function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

function escalate(current: GateResult, next: GateResult): GateResult {
  if (current === "block" || next === "block") return "block";
  if (current === "warn" || next === "warn") return "warn";
  return "allow";
}

export function resolveOutreachGate(
  input: OutreachGateInput,
): OutreachGateDecision {
  const reasons: GateReasonCode[] = [];
  const email = input.candidate.contact_email?.toLowerCase() ?? null;
  const domain = emailDomain(email);
  const orgName = input.candidate.counterparty_org_name?.toLowerCase() ?? null;

  for (const rule of input.dnc_rules) {
    if (rule.status !== "active") continue;
    const value = rule.value.toLowerCase();
    if (rule.rule_type === "email" && email && value === email && rule.severity === "block") {
      reasons.push("dnc_email_block");
    } else if (rule.rule_type === "email_domain" && domain && value === domain && rule.severity === "block") {
      reasons.push("dnc_domain_block");
    } else if (rule.rule_type === "org_name" && orgName && value === orgName && rule.severity === "warn") {
      reasons.push("dnc_org_name_warning");
    }
  }

  switch (input.duplicate_status) {
    case "duplicate_exact_registry_id":
      reasons.push("duplicate_exact_registry_id");
      break;
    case "duplicate_verified_domain":
      reasons.push("duplicate_verified_domain");
      break;
    case "duplicate_soft_name_match":
      reasons.push("duplicate_soft_name_match");
      break;
    case "no_duplicate":
      break;
  }

  if (input.suppression_active) reasons.push("suppression_active");
  if (input.compliance_escalation_open) reasons.push("compliance_escalation_open");

  let result: GateResult = "allow";
  for (const code of reasons) result = escalate(result, GATE_REASON_SEVERITY[code]);

  const seen = new Set<GateReasonCode>();
  const unique = reasons.filter((c) => (seen.has(c) ? false : (seen.add(c), true)));
  return { result, reasons: unique };
}
