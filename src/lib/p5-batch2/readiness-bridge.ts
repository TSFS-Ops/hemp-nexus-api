/**
 * P-5 Batch 2 — Stage 2: Readiness bridge (pure).
 *
 * Translates evidence state into deltas per readiness dimension. Does NOT
 * read the DB and is NOT wired into Batch 1 readiness in Stage 2; later
 * stages will consume the deltas server-side. All inputs come from the
 * checklist-engine + caller-supplied flags.
 */
import type { P5B2ChecklistResult } from "./checklist-engine";

export type P5B2ReadinessDimension =
  | "kyb"
  | "kyc"
  | "governance"
  | "compliance"
  | "bankability"
  | "execution"
  | "finality"
  | "funder_pack"
  | "api";

export type P5B2ReadinessSeverity = "blocker" | "review" | "ok" | "warning";

export interface P5B2ReadinessDelta {
  dimension: P5B2ReadinessDimension;
  severity: P5B2ReadinessSeverity;
  reason: string;
  evidence_key?: string;
}

export interface P5B2ReadinessBridgeInput {
  checklist: P5B2ChecklistResult;
  /** True if changed bank details are pending re-approval. */
  bank_details_changed_pending_approval?: boolean;
  /** True if this record participates in a funder pack. */
  funder_pack_relevant?: boolean;
  /** True if this record participates in an API surface. */
  api_relevant?: boolean;
  /** Active waiver scopes (e.g. "execution", "finality"). */
  active_waiver_scopes?: string[];
}

const CATEGORY_TO_DIM: Record<string, P5B2ReadinessDimension[]> = {
  company: ["kyb", "governance"],
  identity: ["kyc", "governance"],
  ownership: ["kyc", "compliance", "governance"],
  authority: ["governance", "execution"],
  tax: ["compliance"],
  bank: ["bankability", "execution", "finality"],
  regulated: ["compliance"],
  transaction: ["execution", "finality"],
  funder: ["funder_pack"],
  api: ["api"],
};

function dimsFor(category: string): P5B2ReadinessDimension[] {
  return CATEGORY_TO_DIM[category] ?? ["governance"];
}

export function bridgeP5B2Readiness(input: P5B2ReadinessBridgeInput): P5B2ReadinessDelta[] {
  const out: P5B2ReadinessDelta[] = [];
  const waiverScopes = new Set(input.active_waiver_scopes ?? []);

  for (const r of input.checklist.missing_mandatory) {
    for (const dim of dimsFor(r.category)) {
      out.push({
        dimension: dim,
        severity: "blocker",
        reason: `missing_mandatory:${r.key}`,
        evidence_key: r.key,
      });
    }
  }

  for (const r of input.checklist.missing_mandatory_before_finality) {
    out.push({
      dimension: "finality",
      severity: "blocker",
      reason: `missing_before_finality:${r.key}`,
      evidence_key: r.key,
    });
  }

  for (const r of input.checklist.rejected) {
    if (r.level === "mandatory") {
      for (const dim of dimsFor(r.category)) {
        out.push({ dimension: dim, severity: "blocker", reason: `rejected:${r.key}`, evidence_key: r.key });
      }
    }
  }

  for (const r of input.checklist.expired) {
    if (r.level === "mandatory") {
      for (const dim of dimsFor(r.category)) {
        out.push({ dimension: dim, severity: "blocker", reason: `expired:${r.key}`, evidence_key: r.key });
      }
    }
  }

  for (const r of input.checklist.uploaded_unreviewed) {
    if (r.level === "mandatory") {
      out.push({
        dimension: "finality",
        severity: "blocker",
        reason: `uploaded_unreviewed_blocks_finality:${r.key}`,
        evidence_key: r.key,
      });
      out.push({
        dimension: "compliance",
        severity: "review",
        reason: `uploaded_unreviewed:${r.key}`,
        evidence_key: r.key,
      });
    }
  }

  for (const r of input.checklist.provider_dependent) {
    // Provider-dependent evidence may never support live verification claims.
    out.push({
      dimension: "compliance",
      severity: "warning",
      reason: `provider_dependent_not_live:${r.key}`,
      evidence_key: r.key,
    });
    if (r.required_before_finality) {
      out.push({
        dimension: "finality",
        severity: "warning",
        reason: `provider_dependent_blocks_finality_claim:${r.key}`,
        evidence_key: r.key,
      });
    }
  }

  // Weak/unusable signal — derived from rating where caller passes it via
  // checklist evidence. Here we surface the rejected and provider-dependent
  // cases; weak ratings flow as `review`.
  // (Rating is bucketed in rating-engine; readiness consumes outcomes only.)

  for (const r of input.checklist.waived) {
    // Waivers allow progress only within their scope.
    if (waiverScopes.size === 0) {
      out.push({
        dimension: "compliance",
        severity: "warning",
        reason: `waiver_without_scope:${r.key}`,
        evidence_key: r.key,
      });
    } else {
      for (const scope of waiverScopes) {
        out.push({
          dimension: scope as P5B2ReadinessDimension,
          severity: "warning",
          reason: `waived_within_scope:${r.key}`,
          evidence_key: r.key,
        });
      }
    }
  }

  if (input.bank_details_changed_pending_approval) {
    out.push({ dimension: "execution", severity: "blocker", reason: "bank_details_changed_pending_approval" });
    out.push({ dimension: "finality", severity: "blocker", reason: "bank_details_changed_pending_approval" });
  }

  if (input.funder_pack_relevant) {
    // Mandatory items missing for finality also block the funder pack.
    for (const r of input.checklist.missing_mandatory_before_finality) {
      out.push({
        dimension: "funder_pack",
        severity: "blocker",
        reason: `funder_pack_blocked:${r.key}`,
        evidence_key: r.key,
      });
    }
  }

  if (input.api_relevant) {
    for (const r of input.checklist.missing_mandatory) {
      out.push({
        dimension: "api",
        severity: "blocker",
        reason: `api_blocked:${r.key}`,
        evidence_key: r.key,
      });
    }
  }

  return out;
}
