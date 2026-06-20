/**
 * Batch 2 — Registry Provenance, Country Coverage, Import Batches (M010 / M011 / M012).
 * SSOT integrity, parity, state-machine and forbidden-word coverage.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REGISTRY_SOURCE_TYPES,
  REGISTRY_LICENCE_STATUSES,
  REGISTRY_CONFIDENCE_BANDS,
  REGISTRY_VERIFICATION_LEVELS,
  REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES,
  presenceImpliesVerification,
} from "@/lib/registry-provenance";
import {
  COUNTRY_COVERAGE_STATES,
  COUNTRY_COVERAGE_AUDIT_EVENT_NAMES,
  canShowAsProductionReady,
  isSeedOnly,
} from "@/lib/registry-country-coverage";
import {
  IMPORT_BATCH_STATES,
  IMPORT_BATCH_AUDIT_EVENT_NAMES,
  IMPORT_BATCH_ALLOWED_TRANSITIONS,
  canTransition,
} from "@/lib/registry-import-batches";

describe("Batch 2 — M010 provenance SSOT", () => {
  it("declares 7 source types", () => {
    expect([...REGISTRY_SOURCE_TYPES]).toEqual([
      "registry","licensed_dataset","seed_layer","company_claim",
      "admin_enrichment","provider_api","manual_review",
    ]);
  });
  it("declares 5 licence statuses", () => {
    expect(REGISTRY_LICENCE_STATUSES).toHaveLength(5);
  });
  it("declares 5 confidence bands and 6 verification levels", () => {
    expect(REGISTRY_CONFIDENCE_BANDS).toHaveLength(5);
    expect(REGISTRY_VERIFICATION_LEVELS).toHaveLength(6);
  });
  it("declares the four provenance audit names", () => {
    expect([...REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES]).toEqual([
      "registry_source_recorded",
      "registry_source_updated",
      "registry_source_licence_recorded",
      "registry_field_provenance_recorded",
    ]);
  });
  it("hard rule: presence in a dataset is not verification", () => {
    expect(presenceImpliesVerification()).toBe(false);
  });
});

describe("Batch 2 — M011 country coverage SSOT", () => {
  it("declares the 11 approved coverage states", () => {
    expect([...COUNTRY_COVERAGE_STATES]).toEqual([
      "no_coverage","seed_only","sample_only","dataset_acquired",
      "provider_api_available","imported_unverified","claim_enabled",
      "verification_enabled","api_demo_ready","production_ready","disabled",
    ]);
  });
  it("only production_ready may be displayed as production-ready", () => {
    for (const s of COUNTRY_COVERAGE_STATES) {
      expect(canShowAsProductionReady(s)).toBe(s === "production_ready");
    }
  });
  it("seed_only and sample_only are seed states", () => {
    for (const s of COUNTRY_COVERAGE_STATES) {
      expect(isSeedOnly(s)).toBe(s === "seed_only" || s === "sample_only");
    }
  });
  it("declares the coverage audit event names", () => {
    expect([...COUNTRY_COVERAGE_AUDIT_EVENT_NAMES]).toEqual([
      "registry_country_coverage_state_changed",
      "registry_country_coverage_wording_changed",
    ]);
  });
});

describe("Batch 2 — M012 import batch state machine", () => {
  it("declares 12 states", () => {
    expect(IMPORT_BATCH_STATES).toHaveLength(12);
  });
  it("declares the 5 import-batch audit names", () => {
    expect(IMPORT_BATCH_AUDIT_EVENT_NAMES).toHaveLength(5);
  });
  it("publish requires the approved → published transition", () => {
    expect(canTransition("approved", "published")).toBe(true);
    expect(canTransition("validated", "published")).toBe(false);
    expect(canTransition("draft", "published")).toBe(false);
    expect(canTransition("pending_approval", "published")).toBe(false);
  });
  it("terminal states have no outgoing transitions", () => {
    for (const s of ["rejected", "rolled_back", "cancelled"] as const) {
      expect(IMPORT_BATCH_ALLOWED_TRANSITIONS[s]).toEqual([]);
    }
  });
  it("validation_failed loops back to uploaded for re-upload", () => {
    expect(canTransition("validation_failed", "uploaded")).toBe(true);
  });
  it("quarantined requires explicit review path", () => {
    expect(canTransition("quarantined", "validated")).toBe(true);
    expect(canTransition("quarantined", "rejected")).toBe(true);
    expect(canTransition("quarantined", "approved")).toBe(false);
  });
});

describe("Batch 2 — TS ↔ Deno parity", () => {
  it("provenance Deno mirror matches", () => {
    const deno = readFileSync("supabase/functions/_shared/registry-provenance.ts", "utf8");
    for (const s of REGISTRY_SOURCE_TYPES) expect(deno).toContain(`"${s}"`);
    for (const s of REGISTRY_LICENCE_STATUSES) expect(deno).toContain(`"${s}"`);
    for (const s of REGISTRY_CONFIDENCE_BANDS) expect(deno).toContain(`"${s}"`);
    for (const s of REGISTRY_VERIFICATION_LEVELS) expect(deno).toContain(`"${s}"`);
    for (const n of REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES) expect(deno).toContain(`"${n}"`);
  });
  it("country coverage Deno mirror matches", () => {
    const deno = readFileSync("supabase/functions/_shared/registry-country-coverage.ts", "utf8");
    for (const s of COUNTRY_COVERAGE_STATES) expect(deno).toContain(`"${s}"`);
    for (const n of COUNTRY_COVERAGE_AUDIT_EVENT_NAMES) expect(deno).toContain(`"${n}"`);
  });
  it("import batch Deno mirror matches", () => {
    const deno = readFileSync("supabase/functions/_shared/registry-import-batches.ts", "utf8");
    for (const s of IMPORT_BATCH_STATES) expect(deno).toContain(`"${s}"`);
    for (const n of IMPORT_BATCH_AUDIT_EVENT_NAMES) expect(deno).toContain(`"${n}"`);
  });
});

describe("Batch 2 — edge function wiring", () => {
  it("registry-provenance-record requires platform_admin/compliance_owner and emits all 4 audit names", () => {
    const src = readFileSync("supabase/functions/registry-provenance-record/index.ts", "utf8");
    expect(src).toContain("platform_admin");
    expect(src).toContain("compliance_owner");
    for (const n of REGISTRY_PROVENANCE_AUDIT_EVENT_NAMES) expect(src).toContain(`"${n}"`);
    expect(src).toMatch(/z\.string\(\)\.min\(20\)/);
  });
  it("registry-country-coverage-update gates seed→production_ready on approved business_decision", () => {
    const src = readFileSync("supabase/functions/registry-country-coverage-update/index.ts", "utf8");
    expect(src).toContain("platform_admin");
    expect(src).toContain("compliance_owner");
    expect(src).toContain("promotion_requires_business_decision_and_evidence");
    expect(src).toContain("business_decision_not_approved_country");
    for (const n of COUNTRY_COVERAGE_AUDIT_EVENT_NAMES) expect(src).toContain(`"${n}"`);
  });
  it("registry-import-batch-manage enforces state machine and publish requires approved decision", () => {
    const src = readFileSync("supabase/functions/registry-import-batch-manage/index.ts", "utf8");
    expect(src).toContain("platform_admin");
    expect(src).toContain("compliance_owner");
    expect(src).toContain("publish_requires_business_decision_and_evidence");
    expect(src).toContain("business_decision_not_approved");
    expect(src).toContain("invalid_transition");
    for (const n of IMPORT_BATCH_AUDIT_EVENT_NAMES) expect(src).toContain(`"${n}"`);
  });
});

describe("Batch 2 — admin UI hygiene", () => {
  const FORBIDDEN = ["\\bverified\\b", "\\blive\\b", "\\bguaranteed\\b", "\\bproduction-ready\\b"];
  const FILES = [
    "src/components/registry/ProvenanceSourceList.tsx",
    "src/components/registry/CountryCoverageMatrix.tsx",
    "src/components/registry/ImportBatchList.tsx",
    "src/pages/admin/registry/Provenance.tsx",
    "src/pages/admin/registry/Coverage.tsx",
    "src/pages/admin/registry/Imports.tsx",
  ];
  it.each(FILES)("%s carries no forbidden non-production wording", (f) => {
    const src = readFileSync(f, "utf8");
    for (const re of FORBIDDEN) expect(src).not.toMatch(new RegExp(re, "i"));
  });
});

describe("Batch 2 — migration grants and RLS", () => {
  it("migration grants all 9 new tables and enables RLS with admin write policies", () => {
    const fs = require("node:fs");
    const files = fs.readdirSync("supabase/migrations").sort();
    const migration = files
      .map((f: string) => fs.readFileSync(`supabase/migrations/${f}`, "utf8"))
      .find((src: string) => src.includes("registry_data_sources") && src.includes("registry_import_batches"));
    expect(migration).toBeTruthy();
    const tables = [
      "registry_data_sources",
      "registry_source_licences",
      "registry_field_provenance",
      "registry_provenance_events",
      "registry_country_coverage",
      "registry_country_coverage_events",
      "registry_import_batches",
      "registry_import_batch_rows",
      "registry_import_batch_events",
    ];
    for (const t of tables) {
      expect(migration).toContain(`GRANT SELECT ON public.${t} TO authenticated`);
      expect(migration).toContain(`GRANT ALL ON public.${t} TO service_role`);
      expect(migration).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
    }
    // 54-country seed
    expect(migration).toContain("'ZA'");
    expect(migration).toContain("'NG'");
    expect(migration).toContain("seed_only");
  });
});
