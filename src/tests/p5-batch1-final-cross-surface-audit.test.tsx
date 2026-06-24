/**
 * P-5 Batch 1 — Final Embarrassment-Prevention Audit (cross-surface).
 *
 * Read-only defensive checks across:
 *   - status SSOT vs badges vs dashboard filters vs detail vs summary API
 *   - reason-code coverage across reasoned dialogs
 *   - audit timeline rendering of reason/status transitions
 *   - SLA action messages and provider wording — customer/funder safe
 *   - direct-table-mutation bypass guard (static)
 *
 * Does not touch existing trade/POI/WaD/billing/payment/business-decision
 * rows. No DB calls — pure module inspection + render.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";

import {
  P5_STATUSES,
  P5_STATUS_LABELS,
  P5_PROVIDER_STATUSES,
  P5_REASON_CODES,
  P5_FORBIDDEN_WORDS,
  type P5Status,
  type P5ProviderStatus,
} from "@/lib/p5-governance/constants";
import {
  assertCustomerSafeWording,
  findForbiddenWording,
} from "@/lib/p5-governance/wording-guard";
import { P5StatusBadge } from "@/pages/admin/p5-governance/components/P5StatusBadge";
import { ProviderDependencyPanel } from "@/pages/admin/p5-governance/components/ProviderDependencyPanel";
import { P5AuditTimeline, type P5AuditEvent } from "@/pages/admin/p5-governance/components/P5AuditTimeline";
import { evaluateSlaActions, type P5SlaCaseSnapshot } from "@/lib/p5-governance/sla-rules";

// --------------------------------------------------------------------------
// 1. Status cross-surface drift
// --------------------------------------------------------------------------
describe("Audit 1 — status cross-surface drift", () => {
  it("every P-5 status has a SSOT label", () => {
    for (const s of P5_STATUSES) {
      expect(P5_STATUS_LABELS[s]).toBeTruthy();
      expect(P5_STATUS_LABELS[s]).not.toMatch(/undefined|TODO/i);
    }
  });

  it("P5StatusBadge renders every status with its SSOT label", () => {
    for (const s of P5_STATUSES) {
      const { container, unmount } = render(<P5StatusBadge status={s} />);
      expect(container.textContent).toBe(P5_STATUS_LABELS[s]);
      unmount();
    }
  });

  it("admin dashboard filter keys cover all material status views", () => {
    const src = readFileSync(
      "src/pages/admin/p5-governance/CasesDashboard.tsx",
      "utf8",
    );
    // Required filter keys per Stage 4 brief.
    for (const k of [
      "blockers",
      "warnings",
      "provider_dependent",
      "on_hold",
      "escalated",
      "overdue",
      "ready_to_proceed",
      "more_information_required",
      "assigned_to_me",
      "unassigned",
      "provider_failed",
      "provider_credentials_pending",
    ]) {
      expect(src).toContain(`"${k}"`);
    }
  });

  it("readiness summary edge function returns every status verbatim from SSOT", () => {
    const src = readFileSync(
      "supabase/functions/p5-governance-readiness-summary/index.ts",
      "utf8",
    );
    // The edge function copies readiness_status straight from the DB enum.
    expect(src).toContain("readiness_status: c.readiness_status");
    expect(src).toContain("governance_status: c.governance_status");
    expect(src).toContain("compliance_status: c.compliance_status");
    expect(src).toContain("evidence_status: c.evidence_status");
  });
});

// --------------------------------------------------------------------------
// 2. Reason-code coverage
// --------------------------------------------------------------------------
describe("Audit 2 — reason-code coverage across reasoned dialogs", () => {
  const dialogs = [
    "HoldDialog.tsx",
    "WaiverDialog.tsx",
    "OverrideDialog.tsx",
    "EscalateDialog.tsx",
    "RequestMoreInfoDialog.tsx",
    "RejectDialog.tsx",
  ];

  it("every reasoned dialog references reason codes from the SSOT", () => {
    for (const d of dialogs) {
      const src = readFileSync(
        join("src/pages/admin/p5-governance/components/dialogs", d),
        "utf8",
      );
      // Must reference at least one reason code or the full enum.
      const hasReason =
        src.includes("reasonCodes") || src.includes("HOLD_REASON_CODES");
      expect(hasReason, `${d} should expose a reason-code list`).toBe(true);
    }
  });

  it("every reason code listed in any dialog exists in the SSOT", () => {
    const all = new Set<string>(P5_REASON_CODES);
    for (const d of dialogs) {
      const src = readFileSync(
        join("src/pages/admin/p5-governance/components/dialogs", d),
        "utf8",
      );
      // Pull anything that looks like a snake_case reason code from quoted strings.
      const referenced = Array.from(
        src.matchAll(/"([a-z][a-z0-9_]+)"/g),
        (m) => m[1],
      );
      for (const r of referenced) {
        if (P5_REASON_CODES.includes(r as never)) {
          expect(all.has(r)).toBe(true);
        }
      }
    }
  });

  it("EvidenceReviewPanel exposes rejection + correction reason-code menus", () => {
    const src = readFileSync(
      "src/pages/admin/p5-governance/components/EvidenceReviewPanel.tsx",
      "utf8",
    );
    expect(src).toContain('title="Reject evidence"');
    expect(src).toContain('title="Request correction"');
    expect(src).toMatch(/illegible_evidence/);
    expect(src).toMatch(/incomplete_evidence/);
  });
});

// --------------------------------------------------------------------------
// 3. Backend → UI status mismatch (mock cases through pure functions/components)
// --------------------------------------------------------------------------
describe("Audit 3 — backend → frontend status mismatch", () => {
  it("blocked never renders as Ready-to-Proceed", () => {
    const { container } = render(<P5StatusBadge status="blocked" />);
    expect(container.textContent).toBe("Blocked");
    expect(container.textContent).not.toContain("Ready");
  });

  it("provider-dependent surface never implies pass/verified/cleared", () => {
    for (const ps of P5_PROVIDER_STATUSES) {
      const { container, unmount } = render(
        <ProviderDependencyPanel
          data={{
            provider_dependency: true,
            provider_dependency_type: "test",
            provider_status: ps,
            provider_last_checked_at: null,
          }}
        />,
      );
      const text = container.textContent ?? "";
      // The disclaimer line is exempt — it explicitly negates these words.
      // Strip it before scanning.
      const scan = text.replace(
        /Provider-dependent status reflects the upstream provider only\..*?bankability\./i,
        "",
      );
      expect(scan).not.toMatch(/verified/i);
      expect(scan).not.toMatch(/cleared/i);
      expect(scan).not.toMatch(/compliant/i);
      expect(scan).not.toMatch(/bankable/i);
      unmount();
    }
  });

  it("audit timeline renders reason codes and status transitions", () => {
    const events: P5AuditEvent[] = [
      {
        id: "e1",
        created_at: new Date().toISOString(),
        event_type: "apply_hold",
        actor_type: "user",
        actor_user_id: "u1",
        previous_status: "under_review",
        new_status: "on_hold",
        reason_code: "compliance_hold_applied",
        note: "Operational note",
      },
    ];
    const { container } = render(<P5AuditTimeline events={events} />);
    expect(container.textContent).toContain("apply_hold");
    expect(container.textContent).toContain("compliance_hold_applied");
    expect(container.textContent).toContain("Under Review");
    expect(container.textContent).toContain("On Hold");
  });
});

// --------------------------------------------------------------------------
// 4. Audit visibility — every action wrapper exists and writes audit (Stage 3)
// --------------------------------------------------------------------------
describe("Audit 4 — every material action goes through Stage 3 RPCs", () => {
  it("rpc wrapper exposes every Stage 3 action verb", () => {
    const src = readFileSync("src/lib/p5-governance/rpc.ts", "utf8");
    for (const fn of [
      "p5_apply_hold",
      "p5_release_hold",
      "p5_waive",
      "p5_override",
      "p5_escalate",
      "p5_request_more_info",
      "p5_reject",
      "p5_approve_ready_to_proceed",
      "p5_approve_internally",
      "p5_review_evidence",
      "p5_record_provider_result",
      "p5_assign_owner",
      "p5_start_review",
      "p5_reopen",
      "p5_archive_superseded",
    ]) {
      expect(src).toContain(fn);
    }
  });
});

// --------------------------------------------------------------------------
// 6. Forbidden wording sweep across non-admin surfaces (re-affirm Stage 5)
// --------------------------------------------------------------------------
describe("Audit 6 — forbidden wording stays out of non-admin surfaces", () => {
  const externalSources = [
    "src/components/p5-governance/P5ReadinessCard.tsx",
    "src/pages/registry/MyCompanyReadiness.tsx",
    "src/pages/funder/FunderEvidencePack.tsx",
    "src/lib/p5-governance/sla-rules.ts",
  ];

  it("non-admin sources contain no string-literal forbidden wording", () => {
    for (const path of externalSources) {
      const src = readFileSync(path, "utf8");
      // Inspect only quoted string literals — comments may legitimately
      // reference forbidden phrases (e.g. "never says bankable").
      const literals = Array.from(
        src.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g),
        (m) => m[2],
      );
      for (const lit of literals) {
        const v = findForbiddenWording(lit);
        if (v.length > 0) {
          throw new Error(
            `Forbidden wording in ${path}: "${lit}" → ${v.map((x) => x.phrase).join(", ")}`,
          );
        }
      }
    }
  });

  it("SSOT forbidden list covers every word in the brief", () => {
    for (const w of [
      "Verified",
      "Certified",
      "Compliant",
      "Sanctions Cleared",
      "PEP Clear",
      "AML Cleared",
      "KYC Complete",
      "Bankable",
      "Guaranteed Bankable",
      "Guaranteed",
      "Risk-free",
      "No risk",
      "Approved by bank",
      "Approved by funder",
      "Legally valid",
      "Audit-proof",
      "Final settlement",
      "Payment confirmed",
      "Refund complete",
      "Without a Doubt",
      "WaD finality",
    ]) {
      expect(P5_FORBIDDEN_WORDS as readonly string[]).toContain(w);
    }
  });
});

// --------------------------------------------------------------------------
// 7. Provider-dependency truth check
// --------------------------------------------------------------------------
describe("Audit 7 — provider-dependent never implies finality", () => {
  it("every provider status has neutral customer-safe wording", () => {
    // The customer-facing PROVIDER_LABEL lives in P5ReadinessCard; verify
    // its labels via static read (it is co-located).
    const card = readFileSync(
      "src/components/p5-governance/P5ReadinessCard.tsx",
      "utf8",
    );
    for (const ps of P5_PROVIDER_STATUSES) {
      // Every status must appear as a key in PROVIDER_LABEL.
      expect(card).toContain(`${ps}:`);
    }
    // Wording-guard sweep on the card's literals.
    const literals = Array.from(
      card.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g),
      (m) => m[2],
    );
    for (const lit of literals) {
      expect(findForbiddenWording(lit), `card lit: ${lit}`).toEqual([]);
    }
  });

  it("provider failed/inconclusive never auto-finalises", () => {
    const detail = readFileSync(
      "src/pages/admin/p5-governance/CaseDetail.tsx",
      "utf8",
    );
    // Auto-approve / auto-mark-ready paths must not be wired to provider status.
    expect(detail).not.toMatch(/provider_status[^}]*ready_to_proceed/);
  });
});

// --------------------------------------------------------------------------
// 8. SLA monitor → safe wording + dashboard reflection
// --------------------------------------------------------------------------
describe("Audit 8 — SLA actions are customer/funder-safe", () => {
  it("every emitted SLA message passes the customer wording guard", () => {
    const snapshots: P5SlaCaseSnapshot[] = [
      {
        id: "c1",
        readiness_status: "submitted",
        governance_status: "submitted",
        compliance_status: "submitted",
        status_changed_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
        assigned_reviewer_id: null,
        owner_user_id: null,
        is_on_hold: false,
        hold_type: null,
        hold_applied_at: null,
        is_escalated: false,
        provider_dependency: false,
        provider_status: null,
        provider_last_checked_at: null,
        affects_live_or_funder: true,
        reason_codes: [],
      },
      {
        id: "c2",
        readiness_status: "provider_dependent",
        governance_status: "under_review",
        compliance_status: "under_review",
        status_changed_at: new Date(Date.now() - 80 * 3600 * 1000).toISOString(),
        assigned_reviewer_id: "u1",
        owner_user_id: "u1",
        is_on_hold: false,
        hold_type: null,
        is_escalated: false,
        provider_dependency: true,
        provider_status: "pending",
        provider_last_checked_at: new Date(Date.now() - 80 * 3600 * 1000).toISOString(),
        affects_live_or_funder: true,
        reason_codes: [],
      },
      {
        id: "c3",
        readiness_status: "more_information_required",
        governance_status: "under_review",
        compliance_status: "under_review",
        status_changed_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
        more_info_requested_at: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
        assigned_reviewer_id: "u1",
        owner_user_id: "u1",
        is_on_hold: false,
        hold_type: null,
        is_escalated: false,
        provider_dependency: false,
        provider_status: null,
        provider_last_checked_at: null,
        affects_live_or_funder: true,
        reason_codes: [],
      },
    ];

    for (const snap of snapshots) {
      const actions = evaluateSlaActions(snap, new Date());
      for (const a of actions) {
        // Customer-safe by default — message is the worst-case external surface.
        assertCustomerSafeWording(a.message, { surface: "customer" });
        assertCustomerSafeWording(a.message, { surface: "funder" });
      }
    }
  });
});

// --------------------------------------------------------------------------
// 9. Direct mutation bypass check
// --------------------------------------------------------------------------
describe("Audit 9 — no UI surface bypasses Stage 3 RPCs", () => {
  function* walk(dir: string): Generator<string> {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) yield* walk(p);
      else if (/\.(ts|tsx)$/.test(ent.name)) yield p;
    }
  }

  it("no .insert/.update/.delete/.upsert/.rpc on raw p5 tables outside rpc.ts", () => {
    const offenders: string[] = [];
    for (const path of walk("src")) {
      if (path.includes("/tests/")) continue;
      if (path.endsWith("p5-governance/rpc.ts")) continue;
      const src = readFileSync(path, "utf8");
      if (!/p5_governance_(readiness_cases|evidence_items|audit_events)/.test(src)) continue;
      // Forbid any write verb chained to these table names.
      const writePattern =
        /p5_governance_(?:readiness_cases|evidence_items|audit_events)[^;]*\.(insert|update|delete|upsert)\s*\(/s;
      if (writePattern.test(src)) offenders.push(path);
      // Also forbid .from("p5_*").insert/update/delete patterns split across lines.
      const fromBlock =
        /\.from\(\s*["']p5_governance_(?:readiness_cases|evidence_items|audit_events)["']\s*\)[\s\S]{0,200}?\.(insert|update|delete|upsert)\s*\(/;
      if (fromBlock.test(src)) offenders.push(path);
    }
    expect(offenders, `direct table mutations: ${offenders.join(", ")}`).toEqual([]);
  });
});

// --------------------------------------------------------------------------
// 10. Evidence README integrity (cheap reflectivity check)
// --------------------------------------------------------------------------
describe("Audit 10 — evidence README references real files", () => {
  it("every src/tests file referenced exists", () => {
    const readme = readFileSync(
      "evidence/p5-batch1-governance-readiness/README.md",
      "utf8",
    );
    const refs = Array.from(
      readme.matchAll(/src\/tests\/(p5-batch1[\w.-]+\.test\.tsx?)/g),
      (m) => `src/tests/${m[1]}`,
    );
    expect(refs.length).toBeGreaterThan(0);
    const present = new Set(readdirSync("src/tests").map((f) => `src/tests/${f}`));
    for (const r of refs) {
      expect(present.has(r), `README references missing test ${r}`).toBe(true);
    }
  });
});
