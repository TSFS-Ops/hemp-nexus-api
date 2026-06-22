/**
 * Batch 23 — Registry typeahead company search source pins.
 *
 * Source-pins the safety rails and shell-aware behaviour of the
 * CompanyTypeahead component plus the typeahead mount inside the
 * Trade Desk shell's /desk/registry/search page.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const typeahead = readFileSync(
  "src/components/registry/CompanyTypeahead.tsx",
  "utf8",
);
const search = readFileSync("src/pages/registry/Search.tsx", "utf8");
const desk = readFileSync("src/pages/Desk.tsx", "utf8");

describe("Batch 23 — registry typeahead behaviour", () => {
  it("debounces requests (≈200ms) and discards stale responses by sequence", () => {
    expect(typeahead).toMatch(/setTimeout\([^,]+,\s*200\)/);
    expect(typeahead).toMatch(/requestSeqRef/);
    expect(typeahead).toMatch(/seq !== requestSeqRef\.current/);
  });

  it("requires at least 2 characters before querying", () => {
    expect(typeahead).toMatch(/q\.length\s*<\s*2/);
  });

  it("exposes ARIA combobox + listbox + option semantics", () => {
    expect(typeahead).toMatch(/role="combobox"/);
    expect(typeahead).toMatch(/aria-expanded=\{showPanel\}/);
    expect(typeahead).toMatch(/aria-autocomplete="list"/);
    expect(typeahead).toMatch(/aria-activedescendant=/);
    expect(typeahead).toMatch(/role="listbox"/);
    expect(typeahead).toMatch(/role="option"/);
    expect(typeahead).toMatch(/aria-selected=\{isActive\}/);
  });

  it("supports ArrowDown / ArrowUp / Enter / Escape", () => {
    expect(typeahead).toMatch(/"Escape"/);
    expect(typeahead).toMatch(/"ArrowDown"/);
    expect(typeahead).toMatch(/"ArrowUp"/);
    expect(typeahead).toMatch(/"Enter"/);
  });

  it("calls the existing safe edge function with a small limit", () => {
    expect(typeahead).toMatch(/registry-company-search/);
    expect(typeahead).toMatch(/limit:\s*8/);
  });

  it("rebases profile_link onto the active Trade Desk shell base", () => {
    expect(typeahead).toMatch(/rebaseRegistryPath\(r\.profile_link, base\)/);
  });
});

describe("Batch 23 — typeahead safety rails", () => {
  it("client-side filters match reasons to a safe allow-list", () => {
    expect(typeahead).toMatch(/SAFE_MATCH_FIELDS/);
    expect(typeahead).toMatch(/SAFE_MATCH_FIELDS\.has\(m\.field_label\)/);
    // Must include name / registration / VAT / address / activity / officer.
    for (const safe of [
      '"Company name"',
      '"Registration number"',
      '"VAT number"',
      '"Registered address"',
      '"Activity"',
      '"Officer"',
    ]) {
      expect(typeahead).toContain(safe);
    }
  });

  it("never references unsafe fields in the dropdown markup", () => {
    const forbidden = [
      /bank[_-]?account/i,
      /\biban\b/i,
      /personal[_-]?email/i,
      /personal[_-]?phone/i,
      /personal[_-]?address/i,
      /provider[_-]?payload/i,
      /compliance[_-]?note/i,
      /raw[_-]?evidence/i,
    ];
    for (const re of forbidden) expect(typeahead).not.toMatch(re);
  });

  it("never uses verification / production-ready wording in the dropdown", () => {
    const forbidden = [
      /\bverified\b/i,
      /\bproduction[- ]ready\b/i,
      /\bguaranteed\b/i,
      /\bofficially confirmed\b/i,
    ];
    for (const re of forbidden) expect(typeahead).not.toMatch(re);
  });

  it("labels sample / imported_unverified records with a safe chip", () => {
    expect(typeahead).toMatch(/isSampleReadiness/);
    expect(typeahead).toMatch(/"imported_unverified"/);
    expect(typeahead).toMatch(/"sample_only"/);
    expect(typeahead).toMatch(/Sample record/);
  });

  it("no-results state offers the review-gated new-company request", () => {
    expect(typeahead).toMatch(/No company found for this search/);
    expect(typeahead).toMatch(/new-company-request/);
  });

  it("'Show all results' preserves query and country and stays inside the shell", () => {
    expect(typeahead).toMatch(/Show all results/);
    expect(typeahead).toMatch(/params\.set\("q", query\.trim\(\)\)/);
    expect(typeahead).toMatch(/params\.set\("country", countryCode\)/);
    expect(typeahead).toMatch(/\$\{base\}\/search\?/);
  });
});

describe("Batch 23 — Trade Desk shell integration", () => {
  it("Search.tsx mounts the CompanyTypeahead", () => {
    expect(search).toMatch(/import \{ CompanyTypeahead \}/);
    expect(search).toMatch(/<CompanyTypeahead /);
  });

  it("Search.tsx reads ?q= and ?country= so 'Show all results' lands seeded", () => {
    expect(search).toMatch(/useSearchParams/);
    expect(search).toMatch(/searchParams\.get\("q"\)/);
    expect(search).toMatch(/searchParams\.get\("country"\)/);
  });

  it("registry/search route still sits inside the DeskLayout block", () => {
    const open = desk.indexOf("<DeskLayout>");
    const close = desk.indexOf("</DeskLayout>");
    expect(open).toBeGreaterThan(0);
    expect(close).toBeGreaterThan(open);
    expect(desk.slice(open, close)).toMatch(/path="registry\/search"/);
  });
});
