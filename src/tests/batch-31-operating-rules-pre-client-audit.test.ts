/**
 * Batch 31 — Operating Rules Pre-Client Embarrassment Audit.
 *
 * Source-pin sweep across Batches 22–30 to catch any cross-surface
 * mismatch before client-facing packs are generated. Pure file reads
 * — no network, no DB. Pair with `scripts/check-batch-31-cross-
 * surface-consistency.mjs` for the build-time guard.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : "");

describe("Batch 31 — SSOT browser/Deno parity surfaces present", () => {
  const PAIRS: Array<[string, string, string]> = [
    ["src/lib/registry-operating-rules.ts",           "supabase/functions/_shared/registry-operating-rules.ts",           "scripts/check-registry-operating-rules-parity.mjs"],
    ["src/lib/registry-provenance-import-rules.ts",   "supabase/functions/_shared/registry-provenance-import-rules.ts",   "scripts/check-registry-provenance-import-rules-parity.mjs"],
    ["src/lib/registry-search-profile-rules.ts",      "supabase/functions/_shared/registry-search-profile-rules.ts",      "scripts/check-registry-search-profile-rules-parity.mjs"],
    ["src/lib/registry-claim-authority-rules.ts",     "supabase/functions/_shared/registry-claim-authority-rules.ts",     "scripts/check-registry-claim-authority-rules-parity.mjs"],
    ["src/lib/registry-bank-operating-rules.ts",      "supabase/functions/_shared/registry-bank-operating-rules.ts",      "scripts/check-registry-bank-operating-rules-parity.mjs"],
    ["src/lib/registry-api-operating-rules.ts",       "supabase/functions/_shared/registry-api-operating-rules.ts",       "scripts/check-registry-api-operating-rules-parity.mjs"],
    ["src/lib/registry-operations-outreach-rules.ts", "supabase/functions/_shared/registry-operations-outreach-rules.ts", "scripts/check-registry-operations-outreach-rules-parity.mjs"],
  ];
  it.each(PAIRS)("Batch SSOT pair + parity guard exist (%s)", (b, d, g) => {
    expect(existsSync(b)).toBe(true);
    expect(existsSync(d)).toBe(true);
    expect(existsSync(g)).toBe(true);
  });
});

describe("Batch 31 — Batch 30 SSOT pins the canonical disabled labels", () => {
  const s = read("src/lib/registry-operations-outreach-rules.ts");
  it("SMS not configured pinned verbatim", () => {
    expect(s).toContain('"SMS not configured"');
  });
  it("WhatsApp not configured pinned verbatim", () => {
    expect(s).toContain('"WhatsApp not configured"');
  });
  it("AI is draft-only and may never auto-send", () => {
    expect(s).toMatch(/REGISTRY_OPS_AI_DRAFT_ONLY\s*=\s*true/);
    expect(s).toMatch(/REGISTRY_OPS_AI_MAY_AUTO_SEND\s*=\s*false/);
  });
});

describe("Batch 31 — Batch 29 SSOT keeps sandbox-default + raw-bank blocked", () => {
  const s = read("src/lib/registry-api-operating-rules.ts");
  it("default environment is sandbox", () => {
    expect(s).toMatch(/DEFAULT_ENVIRONMENT[^\n]*=\s*['"]sandbox['"]/);
  });
  it("public self-serve production is disabled", () => {
    expect(s).toMatch(/PUBLIC_SELF_SERVE_PRODUCTION[^\n]*=\s*false/);
  });
  it("raw bank API output is blocked by default", () => {
    expect(s).toMatch(/RAW_BANK[^\n]*BLOCKED[^\n]*=\s*true/);
  });
});

describe("Batch 31 — Trade Desk shell still wraps registry routes", () => {
  const desk = read("src/pages/Desk.tsx");
  const open = desk.indexOf("<DeskLayout>");
  const close = desk.indexOf("</DeskLayout>");
  it("DeskLayout block exists", () => {
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
  });
  it("core registry routes live inside DeskLayout", () => {
    const inside = desk.slice(open, close);
    for (const route of [
      'path="registry"',
      'path="registry/search"',
      'path="registry/company/:id"',
      'path="registry/company/:id/claim"',
      'path="registry/my-companies"',
    ]) {
      expect(inside).toContain(route);
    }
  });
  it("no registry route is wrapped in DeskFullBleed", () => {
    const blocks = desk.match(/<DeskFullBleed>[\s\S]*?<\/DeskFullBleed>/g) ?? [];
    for (const b of blocks) expect(b).not.toMatch(/registry/i);
  });
});

describe("Batch 31 — Profile-level claim entry + safe profile rendering", () => {
  const profile = read("src/pages/registry/CompanyProfile.tsx");
  it("renders the 'Is this your company?' claim panel", () => {
    expect(profile).toContain('data-testid="profile-claim-panel"');
    expect(profile).toContain("Is this your company?");
  });
  it("never references raw bank / personal contact fields", () => {
    expect(profile).not.toMatch(
      /bank_account_number|raw_bank_details|personal_email|personal_phone|residential_address/i,
    );
  });
});

describe("Batch 31 — Typeahead safety rails still hold", () => {
  const ty = read("src/components/registry/CompanyTypeahead.tsx");
  it("keeps SAFE_MATCH_FIELDS allow-list", () => {
    expect(ty).toContain("SAFE_MATCH_FIELDS");
  });
  it("does not reference forbidden fields", () => {
    for (const re of [/bank[_-]?account/i, /\biban\b/i, /personal[_-]?email/i, /personal[_-]?phone/i, /provider[_-]?payload/i, /raw[_-]?evidence/i]) {
      expect(ty).not.toMatch(re);
    }
  });
  it("does not use overclaiming wording", () => {
    for (const re of [/\bverified\b/i, /\bguaranteed\b/i, /\bofficially confirmed\b/i, /\bproduction[- ]ready\b/i]) {
      expect(ty).not.toMatch(re);
    }
  });
});

describe("Batch 31 — Release gate does not default to production_ready", () => {
  const gate = read("RELEASE_GATE.md");
  it("RELEASE_GATE.md exists and is non-empty", () => {
    expect(gate.length).toBeGreaterThan(0);
  });
  it("does not assert production_ready as the default final status", () => {
    expect(gate).not.toMatch(/^\s*Final\s+status:\s*production[_ -]?ready\s*$/im);
    expect(gate).not.toMatch(/^\s*Default\s+release\s+status:\s*production[_ -]?ready\s*$/im);
  });
});

describe("Batch 31 — Evidence index + per-batch evidence dirs are present", () => {
  const idx = read("evidence/registry-evidence-index/README.md");
  it.each([24, 25, 26, 27, 28, 29, 30, 31])("registry evidence index references Batch %i", (n) => {
    const hit = idx.includes(`batch-${n}-`) || new RegExp(`\\|\\s*${n}\\s*\\|`).test(idx);
    expect(hit).toBe(true);
  });
  it.each([24, 25, 26, 27, 28, 29, 30, 31])("evidence dir for Batch %i exists with README", (n) => {
    const dirs = readdirSync("evidence").filter(
      (d) => d.startsWith(`batch-${n}-`) && statSync(join("evidence", d)).isDirectory(),
    );
    expect(dirs.length).toBeGreaterThan(0);
    for (const d of dirs) {
      expect(existsSync(join("evidence", d, "README.md"))).toBe(true);
    }
  });
});

describe("Batch 31 — Developer handover + cross-surface matrix exist", () => {
  it("handover doc present", () => {
    expect(existsSync("docs/registry/operating-rules-developer-handover.md")).toBe(true);
  });
  it("cross-surface matrix present", () => {
    expect(existsSync("docs/registry/operating-rules-cross-surface-matrix.md")).toBe(true);
  });
  it("handover references all seven Batch SSOTs", () => {
    const h = read("docs/registry/operating-rules-developer-handover.md");
    for (const f of [
      "registry-operating-rules.ts",
      "registry-provenance-import-rules.ts",
      "registry-search-profile-rules.ts",
      "registry-claim-authority-rules.ts",
      "registry-bank-operating-rules.ts",
      "registry-api-operating-rules.ts",
      "registry-operations-outreach-rules.ts",
    ]) {
      expect(h).toContain(f);
    }
  });
});
