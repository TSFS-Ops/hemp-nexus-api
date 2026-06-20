/**
 * Batch 1 — Business Registry Foundation tests (M001 / M018 / M019).
 * SSOT integrity, parity, and forbidden-word coverage.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_READINESS_STATES,
  REGISTRY_READINESS_COPY,
  REGISTRY_READINESS_LABEL,
  REGISTRY_READINESS_AUDIT_EVENT_NAMES,
  isProductionReady,
  isClientSafe,
} from "@/lib/registry-readiness";
import {
  BUSINESS_DECISION_CATEGORIES,
  BUSINESS_DECISION_STATUSES,
  BUSINESS_DECISION_AUDIT_EVENT_NAMES,
  BUSINESS_DECISION_MIN_RATIONALE_LENGTH,
} from "@/lib/business-decisions";

describe("Batch 1 — registry readiness SSOT", () => {
  it("exposes exactly the 10 approved readiness states in order", () => {
    expect([...REGISTRY_READINESS_STATES]).toEqual([
      "not_started",
      "shell_ready",
      "test_data_ready",
      "provider_pending",
      "data_pending",
      "licence_pending",
      "admin_only",
      "client_demo_ready",
      "production_ready",
      "disabled",
    ]);
  });

  it("has a label and copy string for every state", () => {
    for (const s of REGISTRY_READINESS_STATES) {
      expect(REGISTRY_READINESS_LABEL[s]).toBeTruthy();
      expect(REGISTRY_READINESS_COPY[s]).toBeTruthy();
    }
  });

  it("declares the canonical readiness audit event name", () => {
    expect([...REGISTRY_READINESS_AUDIT_EVENT_NAMES]).toContain(
      "registry_readiness_state_changed",
    );
  });

  it("isProductionReady is true only for production_ready", () => {
    for (const s of REGISTRY_READINESS_STATES) {
      expect(isProductionReady(s)).toBe(s === "production_ready");
    }
  });

  it("isClientSafe is true only for production_ready and client_demo_ready", () => {
    const safe = ["production_ready", "client_demo_ready"];
    for (const s of REGISTRY_READINESS_STATES) {
      expect(isClientSafe(s)).toBe(safe.includes(s));
    }
  });
});

describe("Batch 1 — business decision SSOT", () => {
  it("declares the 9 approved categories", () => {
    expect(BUSINESS_DECISION_CATEGORIES).toHaveLength(9);
    expect([...BUSINESS_DECISION_CATEGORIES]).toContain("country");
    expect([...BUSINESS_DECISION_CATEGORIES]).toContain("api_output");
    expect([...BUSINESS_DECISION_CATEGORIES]).toContain("institutional_demo");
  });

  it("declares the 6 approved statuses", () => {
    expect([...BUSINESS_DECISION_STATUSES]).toEqual([
      "proposed",
      "under_review",
      "approved",
      "rejected",
      "expired",
      "superseded",
    ]);
  });

  it("declares the three audit event names", () => {
    expect([...BUSINESS_DECISION_AUDIT_EVENT_NAMES]).toEqual([
      "business_decision_recorded",
      "business_decision_status_changed",
      "business_decision_superseded",
    ]);
  });

  it("requires a substantial rationale", () => {
    expect(BUSINESS_DECISION_MIN_RATIONALE_LENGTH).toBeGreaterThanOrEqual(30);
  });
});

describe("Batch 1 — TS ↔ Deno parity", () => {
  it("registry-readiness Deno mirror matches the TS SSOT", () => {
    const deno = readFileSync(
      "supabase/functions/_shared/registry-readiness.ts",
      "utf8",
    );
    for (const s of REGISTRY_READINESS_STATES) {
      expect(deno).toContain(`"${s}"`);
    }
    for (const n of REGISTRY_READINESS_AUDIT_EVENT_NAMES) {
      expect(deno).toContain(`"${n}"`);
    }
  });

  it("business-decision Deno mirror matches the TS SSOT", () => {
    const deno = readFileSync(
      "supabase/functions/_shared/business-decisions.ts",
      "utf8",
    );
    for (const c of BUSINESS_DECISION_CATEGORIES) expect(deno).toContain(`"${c}"`);
    for (const s of BUSINESS_DECISION_STATUSES) expect(deno).toContain(`"${s}"`);
    for (const n of BUSINESS_DECISION_AUDIT_EVENT_NAMES) expect(deno).toContain(`"${n}"`);
  });
});

describe("Batch 1 — edge function wiring", () => {
  it("registry-readiness-transition validates reason length and role", () => {
    const src = readFileSync(
      "supabase/functions/registry-readiness-transition/index.ts",
      "utf8",
    );
    expect(src).toContain("platform_admin");
    expect(src).toContain("compliance_owner");
    expect(src).toContain("registry_readiness_state_changed");
    expect(src).toMatch(/z\.string\(\)\.min\(20\)/);
  });

  it("business-decision-record enforces 30+ char rationale and platform_admin", () => {
    const src = readFileSync(
      "supabase/functions/business-decision-record/index.ts",
      "utf8",
    );
    expect(src).toContain("platform_admin");
    expect(src).toContain("compliance_owner");
    expect(src).toContain("business_decision_recorded");
    expect(src).toContain("business_decision_status_changed");
    expect(src).toContain("business_decision_superseded");
    expect(src).toContain("BUSINESS_DECISION_MIN_RATIONALE_LENGTH");
  });
});

describe("Batch 1 — shell copy forbidden-word hygiene", () => {
  const FORBIDDEN = ["\\bverified\\b", "\\blive\\b", "\\bguaranteed\\b", "\\bproduction-ready\\b"];
  const FILES = [
    "src/pages/registry/Landing.tsx",
    "src/pages/registry/Search.tsx",
    "src/pages/registry/CompanyProfile.tsx",
    "src/pages/registry/Claim.tsx",
    "src/pages/registry/Readiness.tsx",
    "src/pages/admin/registry/Index.tsx",
    "src/pages/admin/registry/Readiness.tsx",
    "src/pages/admin/registry/Decisions.tsx",
  ];
  it.each(FILES)("%s contains no forbidden non-production wording", (f) => {
    const src = readFileSync(f, "utf8");
    for (const re of FORBIDDEN) {
      expect(src).not.toMatch(new RegExp(re, "i"));
    }
  });
});

describe("Batch 1 — migration grants and RLS", () => {
  it("migration grants the registry tables to authenticated + service_role and enables RLS", () => {
    const { readdirSync } = require("node:fs");
    const files = readdirSync("supabase/migrations").sort().reverse();
    const target = files.find((f: string) => f.includes("batch_1") || /20260620132/.test(f) || true);
    // Find any migration that references the new tables; pick most recent.
    const migration = files
      .map((f: string) => readFileSync(`supabase/migrations/${f}`, "utf8"))
      .find((src: string) => src.includes("registry_modules") && src.includes("business_decisions"));
    expect(migration).toBeTruthy();
    expect(migration).toContain("GRANT SELECT ON public.registry_modules TO authenticated");
    expect(migration).toContain("GRANT ALL ON public.registry_modules TO service_role");
    expect(migration).toContain("ALTER TABLE public.registry_modules ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE public.business_decisions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY \"registry_modules_write_platform_admin\"");
    expect(migration).toContain("CREATE POLICY \"business_decisions_write_admin\"");
    void target;
  });
});
