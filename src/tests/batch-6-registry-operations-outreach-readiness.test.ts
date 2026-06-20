/**
 * Batch 6 — M013 / M014 / M015 / M017 static + structural proofs. Mirrors
 * the Batch 4/5 style: SSOT parity, audit-name coverage, no-auto-send,
 * forbidden-wording, raw-bank leakage, and route registration checks.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_OUTREACH_DRAFT_STATES,
  REGISTRY_OUTREACH_APPROVAL_STATES,
  REGISTRY_OUTREACH_REVIEW_ACTIONS,
  REGISTRY_OUTREACH_CHANNELS,
  REGISTRY_OUTREACH_SEND_METHODS,
  REGISTRY_OUTREACH_SEND_OUTCOMES,
  REGISTRY_OUTREACH_AUDIT_EVENT_NAMES,
  REGISTRY_OUTREACH_FORBIDDEN_DRAFT_PHRASES,
  REGISTRY_OUTREACH_AI_DRAFT_LABEL,
  REGISTRY_OUTREACH_NO_AUTO_SEND_COPY,
  REGISTRY_CLIENT_READINESS_BUCKETS,
  REGISTRY_CLIENT_READINESS_COPY,
  isDraftWordingSafe,
  evaluateOutreachEligibility,
} from "@/lib/registry-outreach";

const tsSsot = readFileSync("src/lib/registry-outreach.ts", "utf8");
const denoSsot = readFileSync("supabase/functions/_shared/registry-outreach.ts", "utf8");
const draftEdge = readFileSync("supabase/functions/registry-ai-outreach-draft/index.ts", "utf8");
const reviewEdge = readFileSync("supabase/functions/registry-outreach-review/index.ts", "utf8");
const sendEdge = readFileSync("supabase/functions/registry-outreach-log-send/index.ts", "utf8");
const opsEdge = readFileSync("supabase/functions/registry-admin-operations-summary/index.ts", "utf8");
const readinessEdge = readFileSync("supabase/functions/registry-client-readiness-summary/index.ts", "utf8");
const readinessPage = readFileSync("src/pages/registry/Readiness.tsx", "utf8");
const opsPage = readFileSync("src/pages/admin/registry/Operations.tsx", "utf8");
const draftsPage = readFileSync("src/pages/admin/registry/OutreachDrafts.tsx", "utf8");
const apprPage = readFileSync("src/pages/admin/registry/OutreachApprovals.tsx", "utf8");
const dncPage = readFileSync("src/pages/admin/registry/DoNotContact.tsx", "utf8");
const appTsx = readFileSync("src/App.tsx", "utf8");
const deployManifest = readFileSync("scripts/edge-function-deploy-manifest.json", "utf8");
const supaConfig = readFileSync("supabase/config.toml", "utf8");

describe("Batch 6 — SSOT parity (TS ↔ Deno)", () => {
  for (const name of [
    "REGISTRY_OUTREACH_DRAFT_STATES",
    "REGISTRY_OUTREACH_APPROVAL_STATES",
    "REGISTRY_OUTREACH_REVIEW_ACTIONS",
    "REGISTRY_OUTREACH_CHANNELS",
    "REGISTRY_OUTREACH_SEND_METHODS",
    "REGISTRY_OUTREACH_SEND_OUTCOMES",
    "REGISTRY_OUTREACH_AUDIT_EVENT_NAMES",
    "REGISTRY_CLIENT_READINESS_BUCKETS",
  ]) {
    it(`${name} stays byte-aligned`, () => {
      const re = new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`);
      expect(tsSsot.match(re)?.[1].replace(/\s+/g, "")).toBe(denoSsot.match(re)?.[1].replace(/\s+/g, ""));
    });
  }
});

describe("Batch 6 — draft state machine", () => {
  it("has exactly the 8 spec states", () => {
    expect(REGISTRY_OUTREACH_DRAFT_STATES).toEqual([
      "draft_requested","draft_generated","needs_review","edited",
      "approved_for_send","rejected","cancelled","expired",
    ]);
  });
  it("review actions cover the spec", () => {
    for (const a of [
      "review_draft","edit_draft","approve","reject","request_changes",
      "cancel","mark_do_not_contact","suppress_contact","record_manual_send_outcome",
    ]) expect(REGISTRY_OUTREACH_REVIEW_ACTIONS).toContain(a as any);
  });
});

describe("Batch 6 — audit event coverage", () => {
  it("12 canonical audit events declared", () => {
    expect(REGISTRY_OUTREACH_AUDIT_EVENT_NAMES.length).toBe(12);
  });
  it("every audit name is emitted somewhere", () => {
    const haystack = [draftEdge, reviewEdge, sendEdge, opsEdge, readinessEdge].join("\n");
    for (const n of REGISTRY_OUTREACH_AUDIT_EVENT_NAMES) {
      expect(haystack, `audit name ${n} not emitted`).toContain(n);
    }
  });
});

describe("Batch 6 — AI draft labelling and forbidden wording", () => {
  it("AI draft body builder labels output as a draft", () => {
    expect(draftEdge).toContain("REGISTRY_OUTREACH_AI_DRAFT_LABEL");
    expect(REGISTRY_OUTREACH_AI_DRAFT_LABEL).toMatch(/AI-generated draft/);
  });
  it("safe-wording check rejects forbidden phrases", () => {
    for (const phrase of REGISTRY_OUTREACH_FORBIDDEN_DRAFT_PHRASES) {
      const res = isDraftWordingSafe(`Hello ${phrase} world`);
      expect(res.ok).toBe(false);
      expect(res.offenders).toContain(phrase);
    }
  });
  it("safe-wording check accepts clean wording", () => {
    expect(isDraftWordingSafe("This is a draft for review only.")).toEqual({ ok: true, offenders: [] });
  });
});

describe("Batch 6 — eligibility gates", () => {
  it("blocks DNC records", () => {
    expect(evaluateOutreachEligibility({
      do_not_contact: true, country_ready: true, module_enabled: true,
      reason_for_outreach: "x", permitted_use_basis: "y",
    })).toEqual({ allowed: false, reason: "do_not_contact" });
  });
  it("blocks disabled module", () => {
    expect(evaluateOutreachEligibility({
      do_not_contact: false, country_ready: true, module_enabled: false,
      reason_for_outreach: "x", permitted_use_basis: "y",
    }).reason).toBe("module_disabled");
  });
  it("blocks missing permitted use / reason", () => {
    expect(evaluateOutreachEligibility({
      do_not_contact: false, country_ready: true, module_enabled: true,
      reason_for_outreach: "", permitted_use_basis: "y",
    }).reason).toBe("missing_reason");
    expect(evaluateOutreachEligibility({
      do_not_contact: false, country_ready: true, module_enabled: true,
      reason_for_outreach: "x", permitted_use_basis: "",
    }).reason).toBe("missing_permitted_use");
  });
  it("allows when all gates pass", () => {
    expect(evaluateOutreachEligibility({
      do_not_contact: false, country_ready: true, module_enabled: true,
      reason_for_outreach: "x", permitted_use_basis: "y",
    })).toEqual({ allowed: true });
  });
});

describe("Batch 6 — approval is not sending", () => {
  it("review function does not call any external dispatcher", () => {
    for (const banned of ["resend","sendgrid","twilio","mailgun","postmark"]) {
      expect(reviewEdge.toLowerCase()).not.toContain(banned);
    }
  });
  it("send-log function is gated on approved_for_send", () => {
    expect(sendEdge).toContain("approved_for_send");
    expect(sendEdge).toContain("send_not_allowed_from_state");
  });
  it("send-log is gated by a matching approved approval row", () => {
    expect(sendEdge).toContain("registry_outreach_approvals");
    expect(sendEdge).toContain("no_approval_record");
  });
  it("mandatory no-auto-send copy is present everywhere it needs to be", () => {
    for (const src of [reviewEdge, sendEdge, opsEdge, draftsPage, apprPage, opsPage]) {
      expect(
        src.includes(REGISTRY_OUTREACH_NO_AUTO_SEND_COPY) ||
        src.includes("REGISTRY_OUTREACH_NO_AUTO_SEND_COPY"),
      ).toBe(true);
    }
  });
});

describe("Batch 6 — DNC enforcement", () => {
  it("draft generator consults the DNC list", () => {
    expect(draftEdge).toContain("registry_outreach_do_not_contact");
    expect(draftEdge).toContain("do_not_contact");
  });
  it("approval writer also re-checks DNC before approve", () => {
    expect(reviewEdge).toContain("registry_outreach_do_not_contact");
  });
  it("send-log re-checks DNC", () => {
    expect(sendEdge).toContain("registry_outreach_do_not_contact");
  });
});

describe("Batch 6 — readiness dashboard bucket separation", () => {
  it("11 client-readiness buckets exist", () => {
    expect(REGISTRY_CLIENT_READINESS_BUCKETS.length).toBe(11);
    for (const b of [
      "production_ready","client_demo_ready","shell_ready","test_data_ready",
      "seed_only","sample_only","provider_pending","data_pending",
      "licence_pending","business_decision_required","disabled",
    ]) expect(REGISTRY_CLIENT_READINESS_BUCKETS).toContain(b as any);
  });
  it("provider_pending copy never says 'live'", () => {
    expect(REGISTRY_CLIENT_READINESS_COPY.provider_pending.toLowerCase()).not.toMatch(/\blive\b/);
  });
  it("seed_only copy never says 'production-ready'", () => {
    expect(REGISTRY_CLIENT_READINESS_COPY.seed_only.toLowerCase()).not.toContain("production-ready");
  });
  it("readiness page uses SSOT copy (no inline overclaiming)", () => {
    expect(readinessPage).toContain("REGISTRY_CLIENT_READINESS_COPY");
    expect(readinessPage).toContain("REGISTRY_CLIENT_READINESS_HEADLINE");
  });
  it("readiness edge function declares no raw bank-detail fields", () => {
    for (const w of ["account_number","iban","sort_code","swift_bic","routing_number"]) {
      expect(readinessEdge.toLowerCase()).not.toContain(w);
    }
  });
});

describe("Batch 6 — operations dashboard wiring", () => {
  it("ops summary returns the 16 spec sections", () => {
    const sectionsBlock = opsEdge.match(/sections:\s*\[([\s\S]*?)\]/)?.[1] ?? "";
    const codes = [...sectionsBlock.matchAll(/code:\s*"([a-z_]+)"/g)].map(m => m[1]);
    expect(codes).toEqual(expect.arrayContaining([
      "product_readiness","business_decisions","country_coverage","provenance",
      "import_batches","claims","authority","bank_details","api_blocked",
      "outreach_drafts","outreach_approvals","do_not_contact","stale_records",
      "provider_readiness","disputes","audit_summary",
    ]));
    expect(codes.length).toBe(16);
  });
  it("operations dashboard links route to existing admin tabs", () => {
    for (const href of [
      "/admin/registry/readiness","/admin/registry/decisions",
      "/admin/registry/coverage","/admin/registry/provenance",
      "/admin/registry/imports","/admin/registry/claims",
      "/admin/registry/authority","/admin/registry/bank-details",
      "/admin/registry/api","/admin/registry/outreach-drafts",
      "/admin/registry/outreach-approvals","/admin/registry/do-not-contact",
    ]) expect(opsEdge).toContain(href);
  });
});

describe("Batch 6 — admin routes registered", () => {
  for (const p of [
    "/admin/registry/operations",
    "/admin/registry/outreach-drafts",
    "/admin/registry/outreach-approvals",
    "/admin/registry/do-not-contact",
  ]) {
    it(`registers ${p}`, () => {
      expect(appTsx).toContain(`path="${p}"`);
      expect(appTsx).toContain(`role="platform_admin"`);
    });
  }
});

describe("Batch 6 — deploy manifest + supabase config", () => {
  for (const fn of [
    "registry-ai-outreach-draft",
    "registry-outreach-review",
    "registry-outreach-log-send",
    "registry-admin-operations-summary",
    "registry-client-readiness-summary",
  ]) {
    it(`declares ${fn}`, () => {
      expect(deployManifest).toContain(`"${fn}"`);
      expect(supaConfig).toContain(`[functions.${fn}]`);
    });
  }
});

describe("Batch 6 — do-not-contact UI is wired to the audited writer", () => {
  it("DNC page calls the review edge function with mark_do_not_contact action", () => {
    expect(dncPage).toContain("registry-outreach-review");
    expect(dncPage).toContain("mark_do_not_contact");
  });
});
