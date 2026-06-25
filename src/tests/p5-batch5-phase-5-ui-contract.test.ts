/**
 * P-5 Batch 5 — Phase 5 UI contract tests.
 *
 * Static contract checks plus a small set of render assertions for the
 * key permission and projection behaviours. We intentionally avoid the
 * Supabase data layer here — wiring to the Phase 1-3 RPCs is a follow-on
 * data hook task; the UI scaffold must not mutate finality rows or
 * hand-roll the API-safe projection.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  projectFinalityToApiSafe,
  type P5B5ProjectionInput,
} from "@/lib/p5-batch5/api-safe";
import { P5B5_FORBIDDEN_WORDS } from "@/lib/p5-batch5/outcomes";
import {
  P5B5_APPROVED_PHRASES,
  findP5B5BannedPhrases,
} from "@/lib/p5-batch5/wording";

const ROOT = process.cwd();
function read(rel: string): string {
  const p = join(ROOT, rel);
  if (!existsSync(p)) throw new Error(`missing: ${rel}`);
  return readFileSync(p, "utf8");
}

const PAGES = [
  "src/pages/admin/p5-batch5/FinalityMemory.tsx",
  "src/pages/desk/p5-batch5/OrganisationFinality.tsx",
  "src/pages/funder/p5-batch5/FunderFinality.tsx",
];

const COMPONENTS = [
  "src/components/p5-batch5/CounterpartyFinalitySummary.tsx",
  "src/components/p5-batch5/MemoryHistoryPanel.tsx",
  "src/components/p5-batch5/ApiSafePreviewPanel.tsx",
  "src/components/p5-batch5/WarningBanners.tsx",
  "src/components/p5-batch5/ReasonedActionDialog.tsx",
];

const ALL = [...PAGES, ...COMPONENTS];

describe("P-5 Batch 5 Phase 5 — files exist", () => {
  it.each(ALL)("ships %s", (path) => {
    const text = read(path);
    expect(text.length).toBeGreaterThan(100);
    expect(text).toMatch(/export\s+(default\s+)?(function|const)\s+/);
  });
});

describe("P-5 Batch 5 Phase 5 — routes registered and guarded", () => {
  const app = read("src/App.tsx");

  it("registers admin route under platform_admin guard", () => {
    expect(app).toMatch(/path="\/admin\/p5-batch5\/finality-memory"/);
    expect(app).toMatch(/\/admin\/p5-batch5\/finality-memory[\s\S]*role="platform_admin"/);
  });

  it("registers organisation route inside RequireAuth", () => {
    expect(app).toMatch(/path="\/desk\/p5-batch5\/finality"[\s\S]*RequireAuth/);
  });

  it("registers funder route inside RequireAuth", () => {
    expect(app).toMatch(/path="\/funder\/p5-batch5\/finality"[\s\S]*RequireAuth/);
  });
});

describe("P-5 Batch 5 Phase 5 — UI never mutates finality rows directly", () => {
  it.each(ALL)("file %s has no direct supabase.from(finality/memory) mutation", (path) => {
    const text = read(path);
    expect(text).not.toMatch(/supabase\s*\.\s*from\(\s*['"]p5_batch4_finality_records/);
    expect(text).not.toMatch(/supabase\s*\.\s*from\(\s*['"]p5_batch5_memory_records/);
    // No raw RPC invocation hand-rolled in the UI scaffold.
    expect(text).not.toMatch(/supabase\s*\.\s*rpc\(\s*['"]p5b5_/);
  });
});

describe("P-5 Batch 5 Phase 5 — API-safe preview uses Phase 4 projection", () => {
  it("imports projectFinalityToApiSafe from the api-safe module", () => {
    const text = read("src/components/p5-batch5/ApiSafePreviewPanel.tsx");
    expect(text).toMatch(/projectFinalityToApiSafe/);
    expect(text).toMatch(/from\s+["']@\/lib\/p5-batch5\/api-safe["']/);
  });

  it("never hand-rolls projection JSON in the panel", () => {
    const text = read("src/components/p5-batch5/ApiSafePreviewPanel.tsx");
    // Sanity: no inline allowlist redefinition.
    expect(text).not.toMatch(/const\s+ALLOWLIST\s*=/);
  });

  it("projection respects scopes from Phase 4", () => {
    const input: P5B5ProjectionInput = {
      finality_status: "final",
      final_outcome_code: "COMPLETED",
      evidence_rating: "B+",
      finality_record_reference: "fr_1",
      hash_reference: "h_1",
      provider_dependency_status: "success",
    };
    const noScope = projectFinalityToApiSafe(input, { api_scopes: ["finality.read"] });
    if (noScope.blocked !== false) throw new Error("expected projection");
    expect(noScope.evidence_rating).toBeNull();
    expect(noScope.hash_reference).toBeNull();
    expect(noScope.finality_record_reference).toBeNull();
    expect(noScope.provider_dependency_status).toBeNull();

    const full = projectFinalityToApiSafe(input, {
      api_scopes: ["finality.read", "evidence_rating.read", "audit.read", "provider_dependency.read"],
    });
    if (full.blocked !== false) throw new Error("expected projection");
    expect(full.evidence_rating).toBe("B+");
    expect(full.hash_reference).toBe("h_1");
    expect(full.provider_dependency_status).toBe("success");
  });
});

describe("P-5 Batch 5 Phase 5 — sensitive fields never displayed", () => {
  const FORBIDDEN_RAW = [
    "raw_provider_payload",
    "raw_bank_details",
    "internal_notes",
    "private_notes",
    "support_notes",
    "draft_ai_suggestions",
  ];
  it.each(ALL)("file %s never displays raw sensitive field names", (path) => {
    const text = read(path);
    for (const k of FORBIDDEN_RAW) {
      // Allow the field name to appear in a documentation comment, but not
      // as a JSX field render. We assert no JSX `{xx.raw_provider_payload}` shape.
      const re = new RegExp(`\\{[^}]*\\.${k}[^}]*\\}`);
      expect(text).not.toMatch(re);
    }
  });
});

describe("P-5 Batch 5 Phase 5 — reasoned-action dialog wiring", () => {
  const dialog = read("src/components/p5-batch5/ReasonedActionDialog.tsx");

  it("requires a non-empty reason before submit", () => {
    expect(dialog).toMatch(/reason\.trim\(\)\.length\s*<\s*8/);
  });
  it("requires the confirm checkbox", () => {
    expect(dialog).toMatch(/!confirmed/);
  });
  it("checks role permission inside the submit path", () => {
    expect(dialog).toMatch(/!permitted/);
  });
  it("blocks banned wording inside reason text", () => {
    expect(dialog).toMatch(/findP5B5BannedPhrases/);
    expect(findP5B5BannedPhrases("This is guaranteed").length).toBeGreaterThan(0);
  });
});

describe("P-5 Batch 5 Phase 5 — warning banner coverage", () => {
  const banners = read("src/components/p5-batch5/WarningBanners.tsx");
  it("references each reliance-affecting phrase via the approved-wording SSOT", () => {
    for (const key of [
      "UNDER_DISPUTE_SHORT",
      "MEMORY_PAUSED",
      "SUPERSEDED",
      "CORRECTED_SHORT",
      "EXCLUDED_FROM_MEMORY",
      "PROVIDER_DEPENDENCY",
      "TEST_OR_INVALID",
    ]) {
      expect(banners).toMatch(new RegExp(`P5B5_APPROVED_PHRASES\\.${key}\\b`));
    }
  });
  it("approved-phrase values are non-empty", () => {
    expect(P5B5_APPROVED_PHRASES.MEMORY_PAUSED.length).toBeGreaterThan(0);
    expect(P5B5_APPROVED_PHRASES.SUPERSEDED.length).toBeGreaterThan(0);
  });
});

describe("P-5 Batch 5 Phase 5 — banned wording absent from UI", () => {
  it.each(ALL)("file %s contains no banned phrases", (path) => {
    const text = read(path).toLowerCase();
    for (const phrase of P5B5_FORBIDDEN_WORDS) {
      expect(text.includes(phrase.toLowerCase()), `banned: ${phrase}`).toBe(false);
    }
  });
});

describe("P-5 Batch 5 Phase 5 — drift guard exists", () => {
  it("ships scripts/check-p5-batch5-ui-wording.mjs", () => {
    const text = read("scripts/check-p5-batch5-ui-wording.mjs");
    expect(text).toMatch(/check-p5-batch5-ui-wording/);
    for (const phrase of P5B5_FORBIDDEN_WORDS) {
      expect(text).toContain(phrase);
    }
  });
});
