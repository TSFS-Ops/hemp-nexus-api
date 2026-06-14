/**
 * Phase 2 — Shared outreach context loader.
 *
 * Loads everything the server-side outreach gate needs in one place and
 * runs `resolveOutreachGate`. Used by:
 *   - facilitation-outreach-candidate-add  (initial gate evaluation)
 *   - facilitation-outreach-send           (re-evaluation immediately
 *                                           before dispatch)
 *
 * The loader is intentionally read-only: it never mutates POI, WaD,
 * matches, token_ledger, credit/payment records, poi_engagements, or
 * compliance_cases.
 */
// deno-lint-ignore-file no-explicit-any
import { resolveOutreachGate, type DncRuleSnapshot, type OutreachGateDecision } from "./facilitation-outreach-gate.ts";
import type { DuplicateGateStatus } from "./facilitation-outreach-constants.ts";

const PHASE_2_AUDIT_NAMES = [
  "facilitation_outreach.template.approved",
  "facilitation_outreach.template.archived",
  "facilitation_outreach.candidate.added",
  "facilitation_outreach.gate.evaluated",
  "facilitation_outreach.send.dispatched",
  "facilitation_outreach.send.suppressed",
  "facilitation_outreach.send.blocked",
  "facilitation_outreach.escalation.opened",
  "facilitation_outreach.escalation.resolved",
  "facilitation_outreach.escalation.reopened",
] as const;
export const FACILITATION_OUTREACH_AUDIT_NAMES = PHASE_2_AUDIT_NAMES;
export type FacilitationOutreachAudit = (typeof PHASE_2_AUDIT_NAMES)[number];

export interface CandidateRow {
  id: string;
  facilitation_case_id: string;
  contact_email: string;
  org_name: string | null;
}

function normEmail(s: string | null | undefined): string | null {
  return s ? s.trim().toLowerCase() : null;
}
function domainOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at < 0 ? null : email.slice(at + 1).toLowerCase();
}
function normName(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function domainFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch { return null; }
}

export async function evaluateDuplicateStatus(
  admin: any,
  candidate: { contact_email: string; org_name: string | null },
): Promise<DuplicateGateStatus> {
  const emailDomain = domainOf(normEmail(candidate.contact_email));
  const orgNorm = normName(candidate.org_name);

  if (emailDomain) {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id,website")
      .not("website", "is", null)
      .limit(2000);
    for (const o of orgs ?? []) {
      const d = domainFromUrl(o.website);
      if (d && d === emailDomain) return "duplicate_verified_domain";
    }
  }
  if (orgNorm) {
    const { data: orgs } = await admin
      .from("organizations")
      .select("id,name,legal_name")
      .limit(2000);
    for (const o of orgs ?? []) {
      if (normName(o.name) === orgNorm) return "duplicate_soft_name_match";
      if (normName(o.legal_name) === orgNorm) return "duplicate_soft_name_match";
    }
  }
  return "no_duplicate";
}

export async function loadDncSnapshots(
  admin: any,
  candidate: { contact_email: string; org_name: string | null },
): Promise<DncRuleSnapshot[]> {
  const email = normEmail(candidate.contact_email);
  const domain = domainOf(email);
  const orgNorm = normName(candidate.org_name);

  const { data: rules } = await admin
    .from("facilitation_do_not_contact_rules")
    .select("rule_type,value_norm,match_severity,status")
    .eq("status", "active");

  const out: DncRuleSnapshot[] = [];
  for (const r of rules ?? []) {
    // DB stores rule_type as 'email' | 'domain' | 'org_name'.
    // SSOT vocabulary uses 'email_domain' for the domain variant.
    const mappedType =
      r.rule_type === "domain" ? "email_domain" :
      r.rule_type === "email" ? "email" :
      r.rule_type === "org_name" ? "org_name" : null;
    if (!mappedType) continue;
    out.push({
      rule_type: mappedType,
      value: r.value_norm,
      status: r.status as "active",
      severity: r.match_severity as "block" | "warn",
    });
  }

  // Filter to rules that could possibly match this candidate.
  return out.filter((r) => {
    if (r.rule_type === "email") return !!email && r.value === email;
    if (r.rule_type === "email_domain") return !!domain && r.value === domain;
    if (r.rule_type === "org_name") return !!orgNorm && r.value === orgNorm;
    return false;
  });
}

export async function suppressionActive(
  admin: any,
  email: string,
): Promise<boolean> {
  const e = normEmail(email);
  if (!e) return false;
  const { data } = await admin
    .from("suppressed_emails")
    .select("email")
    .eq("email", e)
    .maybeSingle();
  return !!data;
}

export async function openEscalationCount(
  admin: any,
  candidateId: string,
): Promise<number> {
  const { count } = await admin
    .from("facilitation_compliance_escalations")
    .select("id", { count: "exact", head: true })
    .eq("candidate_id", candidateId)
    .eq("status", "open");
  return count ?? 0;
}

export interface FullGateContext {
  decision: OutreachGateDecision;
  duplicate_status: DuplicateGateStatus;
  suppression_active: boolean;
  open_escalations: number;
}

export async function runFullGate(
  admin: any,
  candidate: CandidateRow,
): Promise<FullGateContext> {
  const [dnc, dup, sup, esc] = await Promise.all([
    loadDncSnapshots(admin, candidate),
    evaluateDuplicateStatus(admin, candidate),
    suppressionActive(admin, candidate.contact_email),
    openEscalationCount(admin, candidate.id),
  ]);
  const decision = resolveOutreachGate({
    candidate: {
      contact_email: candidate.contact_email,
      counterparty_org_name: candidate.org_name,
    },
    dnc_rules: dnc,
    duplicate_status: dup,
    suppression_active: sup,
    compliance_escalation_open: esc > 0,
  });
  return {
    decision,
    duplicate_status: dup,
    suppression_active: sup,
    open_escalations: esc,
  };
}

export async function writeOutreachAudit(
  admin: any,
  args: {
    action: FacilitationOutreachAudit;
    entity_type: "facilitation_outreach_template" | "facilitation_outreach_candidate" | "facilitation_outreach_send" | "facilitation_compliance_escalation";
    entity_id: string;
    actor_user_id: string | null;
    org_id?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      org_id: args.org_id ?? "00000000-0000-0000-0000-000000000000",
      action: args.action,
      entity_type: args.entity_type,
      entity_id: args.entity_id,
      actor_user_id: args.actor_user_id,
      metadata: args.metadata ?? {},
    });
  } catch (e) {
    console.warn("[facilitation-outreach] audit insert failed", args.action, e);
  }
}
