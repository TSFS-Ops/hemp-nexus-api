/**
 * Batch O + Batch O Remainder — IDV/KYB/screening trust-signal guards.
 *
 * Sibling to the Deno smoke tests at
 * `supabase/functions/idv-verify/o_production_lockout_smoke_test.ts`.
 *
 * This suite proves the two P5B2 trust-signal contracts that the
 * original Batch O guard missed:
 *
 *  1. `EvidencePackView` still uses neutral wording AND its GATE_03 /
 *     GATE_04 / GATE_05 statuses can no longer be promoted to the
 *     green `"verified"` badge from event-log heuristics or from
 *     `match.status === "settled" / "completed"`.
 *  2. `counterparties.verified` is not exposed as a customer-facing
 *     trust signal via ANY of the previously-missed vectors:
 *       - direct `.verified` accessors in customer-facing src files;
 *       - the `verified_registry` source label or `Verified entity`
 *         coherence factor in edge functions;
 *       - `metadata.verified` in customer-facing search responses;
 *       - the emerald "verified" count chip in the search UI.
 *
 * Scan scope was extended in Batch O Remainder to include
 * `supabase/functions/**` and `src/lib/**` (the previous guard only
 * scanned `src/components/**` + `src/pages/**`, which is why the
 * `search/index.ts → CompactCounterpartyRow.tsx → CounterpartySearch.tsx`
 * leak was not caught).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const EVIDENCE_VIEW = join(
  ROOT,
  "src",
  "components",
  "desk",
  "evidence",
  "EvidencePackView.tsx",
);
const SEARCH_EDGE = join(ROOT, "supabase", "functions", "search", "index.ts");
const COMPACT_ROW = join(
  ROOT,
  "src",
  "components",
  "search",
  "CompactCounterpartyRow.tsx",
);
const COUNTERPARTY_SEARCH = join(
  ROOT,
  "src",
  "components",
  "CounterpartySearch.tsx",
);

// =====================================================================
// EvidencePackView — neutral wording + gate-status derivation
// =====================================================================

describe("Batch O Part 2 — EvidencePackView neutral wording", () => {
  const src = readFileSync(EVIDENCE_VIEW, "utf8");

  it("no longer uses 'KYB Status Cleared (Both Parties)'", () => {
    expect(src).not.toMatch(/KYB Status Cleared/);
  });

  it("no longer uses 'Jurisdiction & Sanctions Reviewed'", () => {
    expect(src).not.toMatch(/Jurisdiction\s*&\s*Sanctions Reviewed/);
  });

  it("uses the neutral 'KYB evidence recorded' label", () => {
    expect(src).toMatch(/KYB evidence recorded/);
  });

  it("uses the neutral 'Jurisdiction and sanctions evidence recorded' label", () => {
    expect(src).toMatch(/Jurisdiction and sanctions evidence recorded/);
  });
});

describe("Batch O Remainder — EvidencePackView gate-status derivation", () => {
  const src = readFileSync(EVIDENCE_VIEW, "utf8");

  it("declares the `evidence_recorded` neutral status alongside verified/pending/blocked", () => {
    expect(src).toMatch(
      /type\s+GateStatus\s*=\s*"verified"\s*\|\s*"evidence_recorded"\s*\|\s*"pending"\s*\|\s*"blocked"/,
    );
  });

  // Extract the deriveGates() function body so the assertions below are
  // scoped to gate derivation rather than the whole file (which contains
  // unrelated "isSettled" ternaries in other gates).
  function extractGate(id: string): string {
    const m = src.match(new RegExp(`id:\\s*"${id}"[\\s\\S]*?\\}`));
    return m ? m[0] : "";
  }

  it("GATE_03 (KYB) never promotes to `verified` from isSettled or bare heuristics", () => {
    const block = extractGate("GATE_03");
    expect(block, "GATE_03 block must be present").not.toBe("");
    expect(block, "GATE_03 must not reference isSettled").not.toMatch(/isSettled/);
    expect(
      block,
      "GATE_03 must NOT emit the green `verified` status — only `evidence_recorded` or `pending`",
    ).not.toMatch(/"verified"/);
    expect(block).toMatch(/"evidence_recorded"/);
    expect(block).toMatch(/"pending"/);
  });

  it("GATE_04 (Jurisdiction/sanctions) never promotes to `verified` from isSettled or bare heuristics", () => {
    const block = extractGate("GATE_04");
    expect(block, "GATE_04 block must be present").not.toBe("");
    expect(block, "GATE_04 must not reference isSettled").not.toMatch(/isSettled/);
    expect(
      block,
      "GATE_04 must NOT emit the green `verified` status",
    ).not.toMatch(/"verified"/);
    expect(block).toMatch(/"evidence_recorded"/);
    expect(block).toMatch(/"pending"/);
  });

  it("GATE_05 (UBO/authority) never promotes to `verified` — neutral evidence-only", () => {
    const block = extractGate("GATE_05");
    expect(block, "GATE_05 block must be present").not.toBe("");
    expect(
      block,
      "GATE_05 must NOT emit the green `verified` status",
    ).not.toMatch(/"verified"/);
    expect(block).toMatch(/"evidence_recorded"/);
  });

  it("badge renderer distinguishes verified vs evidence_recorded vs pending trailing labels", () => {
    // The renderer must emit "recorded" (not "verified") for the neutral
    // evidence-recorded state; this is asserted textually to make
    // regressions in the renderer immediately obvious.
    expect(src).toMatch(/isEvidenceRecorded\s*=\s*gate\.status\s*===\s*"evidence_recorded"/);
    expect(src).toMatch(/isEvidenceRecorded\s*\?\s*"recorded"\s*:\s*"pending"/);
    // Only cryptographically-verifiable gates render as green +
    // white-check — the check icon must remain gated on `isVerified`.
    expect(src).toMatch(/isVerified\s*\?\s*<Check\b/);
  });
});

// =====================================================================
// counterparties.verified — customer-facing containment across scopes
// =====================================================================

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      // Never descend into build/vendor/test-evidence directories.
      if (
        name === "node_modules" ||
        name === "dist" ||
        name === ".git" ||
        name === "test-evidence"
      ) continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

describe("Batch O Remainder — counterparties.verified customer-facing containment", () => {
  // Scan the four scopes the audit identified as customer-facing:
  //   - src/components/**
  //   - src/pages/**
  //   - src/lib/**
  //   - supabase/functions/**
  // Admin / developer / governance / test-mode surfaces are exempt (they
  // are allowed to reference the underlying column for audit / diagnostic
  // purposes), as are test files, forbidden-word registries, and the
  // Supabase auto-generated types file.
  const files = [
    ...walk(join(ROOT, "src", "components")),
    ...walk(join(ROOT, "src", "pages")),
    ...walk(join(ROOT, "src", "lib")),
    ...walk(join(ROOT, "supabase", "functions")),
  ];

  const CUSTOMER_FACING_EXEMPT = [
    join("src", "components", "admin"),
    join("src", "pages", "admin"),
    join("src", "components", "developer"),
    join("src", "components", "governance"),
    join("src", "pages", "GovernanceAudits"),
    join("src", "pages", "GovernanceEntities"),
    join("src", "pages", "GovernanceHealth"),
    join("src", "pages", "GovernanceTriage"),
    join("src", "integrations", "supabase", "types.ts"),
  ];
  const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__|_test\.ts$|smoke_test\.ts$|src[\/\\]tests[\/\\])/;

  function relative(f: string) {
    return f.slice(ROOT.length + 1).split("\\").join("/");
  }

  function exempt(rel: string) {
    if (TEST_FILE.test(rel)) return true;
    return CUSTOMER_FACING_EXEMPT.some((p) => rel.startsWith(p.split("\\").join("/")));
  }

  it("no direct .verified accessor reaches customer-facing surfaces", () => {
    const FORBIDDEN_ACCESSORS = [
      /\bcounterparty\?\.verified\b/,
      /\bcounterparty\.verified\b/,
      /\bcounterparties\?\.verified\b/,
      /\bcounterparties\.verified\b/,
      /\bcp\.verified\b/,
      /\brow\.verified\b(?=[\s\S]{0,120}counterpart)/,
    ];
    const offences: string[] = [];
    for (const f of files) {
      const rel = relative(f);
      if (exempt(rel)) continue;
      const src = readFileSync(f, "utf8");
      for (const re of FORBIDDEN_ACCESSORS) {
        if (re.test(src)) offences.push(`${rel}: ${re}`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("no customer-facing surface emits the `verified_registry` source label", () => {
    // Legacy alias may only appear in the two backward-compat mapping
    // shims (CompactCounterpartyRow tierFromSource + CounterpartySearch
    // reducer) and in the guard-test files themselves.
    const LEGACY_ALIAS_ALLOWED = [
      "src/components/search/CompactCounterpartyRow.tsx",
      "src/components/CounterpartySearch.tsx",
    ];
    const offences: string[] = [];
    for (const f of files) {
      const rel = relative(f);
      if (exempt(rel)) continue;
      if (LEGACY_ALIAS_ALLOWED.includes(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (/["']verified_registry["']/.test(src)) {
        offences.push(`${rel}: emits "verified_registry"`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("no customer-facing surface renders the legacy 'Verified registry' label", () => {
    const offences: string[] = [];
    for (const f of files) {
      const rel = relative(f);
      if (exempt(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (/["']Verified registry["']/.test(src)) {
        offences.push(`${rel}: renders "Verified registry"`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("no customer-facing surface exposes 'Verified entity' as a coherence factor", () => {
    const offences: string[] = [];
    for (const f of files) {
      const rel = relative(f);
      if (exempt(rel)) continue;
      const src = readFileSync(f, "utf8");
      if (/["']Verified entity["']/.test(src)) {
        offences.push(`${rel}: emits "Verified entity"`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });
});

// =====================================================================
// Search leak — direct source-level pins on the three files that
// previously carried the counterparties.verified leak.
// =====================================================================

describe("Batch O Remainder — search/index.ts trust-signal correction", () => {
  const src = readFileSync(SEARCH_EDGE, "utf8");

  it("does not select the `verified` column from counterparties", () => {
    expect(src, "select() must not include the bare `verified` boolean column").not.toMatch(
      /\.select\([^)]*\bverified\b[^)]*\)/,
    );
  });

  it("does not emit `verified_registry` as a source", () => {
    expect(src).not.toMatch(/["']verified_registry["']/);
  });

  it("does not emit `Verified entity` as a coherence factor", () => {
    expect(src).not.toMatch(/["']Verified entity["']/);
  });

  it("does not include `verified` in the returned metadata block", () => {
    // Anchor tightly on the cp mapper's metadata block so we don't
    // accidentally sweep unrelated audit_logs metadata objects.
    const metaBlock = src.match(/metadata:\s*\{\s*org_id:\s*cp\.org_id[\s\S]*?\},/);
    expect(metaBlock, "counterparty metadata block must be present").not.toBeNull();
    expect(metaBlock![0]).not.toMatch(/\bverified\b/);
  });


  it("uses the neutral `registry_record` source with a uniform score (no cp.verified boost)", () => {
    expect(src).toMatch(/source:\s*["']registry_record["']/);
    expect(src).not.toMatch(/score:\s*cp\.verified\s*\?/);
  });
});

describe("Batch O Remainder — CompactCounterpartyRow trust-signal correction", () => {
  const src = readFileSync(COMPACT_ROW, "utf8");

  it("removes the legacy `verified` tier entirely", () => {
    // The Tier union must not contain the standalone "verified" tier.
    expect(src).toMatch(/type\s+Tier\s*=\s*"registry"\s*\|\s*"order_book"\s*\|\s*"web"\s*\|\s*"unknown"/);
  });

  it("does not render the label 'Verified registry'", () => {
    expect(src).not.toMatch(/["']Verified registry["']/);
  });

  it("does not use the emerald ring/dot for any registry-derived tier", () => {
    // The whole `bg-[hsl(var(--emerald))] ring-emerald-200` styling used
    // to be attached to the `verified` tier. It must not be reintroduced
    // for the neutral `registry` tier.
    expect(src).not.toMatch(/case\s+"verified":\s*[\r\n]+\s*return\s+"bg-\[hsl\(var\(--emerald\)\)\]/);
  });

  it("maps the legacy `verified_registry` source string to the neutral registry tier for cached results", () => {
    // Legacy alias must be visible in tierFromSource so cached search
    // results served before the search fn redeploy still render safely.
    expect(src).toMatch(/case\s+"registry_record":[\s\S]*case\s+"verified_registry":[\s\S]*case\s+"counterparty_registry":/);
  });
});

describe("Batch O Remainder — CounterpartySearch header chip correction", () => {
  const src = readFileSync(COUNTERPARTY_SEARCH, "utf8");

  it("removes the emerald 'verified' count chip from the header", () => {
    expect(src).not.toMatch(/counts\.verified\s*>\s*0/);
    expect(src).not.toMatch(/\{counts\.verified\}\s*verified/);
    // Emerald chip class no longer wraps a verified count. (Emerald
    // styling remains permitted on the selected-row highlight and the
    // Create-Draft-Match button — those are unrelated to trust.)
    expect(src).not.toMatch(
      /bg-emerald-50 text-emerald-700[^`]*\{counts\.verified\}/,
    );
  });

  it("collapses legacy `verified_registry` into the neutral `registered` counter for cached results", () => {
    expect(src).toMatch(/r\.source\s*===\s*"registry_record"/);
    expect(src).toMatch(/r\.source\s*===\s*"verified_registry"/);
    expect(src).toMatch(/r\.source\s*===\s*"counterparty_registry"/);
  });
});

// =====================================================================
// Regression net — one composite test that fails if ANY customer-facing
// surface reintroduces a `counterparties.verified`-derived trust label.
// =====================================================================

describe("Batch O Remainder — composite regression net", () => {
  const CUSTOMER_FACING_ROOTS = [
    join(ROOT, "src", "components"),
    join(ROOT, "src", "pages"),
    join(ROOT, "src", "lib"),
    join(ROOT, "supabase", "functions"),
  ];
  const CUSTOMER_FACING_EXEMPT = [
    "src/components/admin",
    "src/pages/admin",
    "src/components/developer",
    "src/components/governance",
    "src/pages/GovernanceAudits",
    "src/pages/GovernanceEntities",
    "src/pages/GovernanceHealth",
    "src/pages/GovernanceTriage",
    "src/integrations/supabase/types.ts",
  ];
  const LEGACY_ALIAS_ALLOWED = new Set([
    "src/components/search/CompactCounterpartyRow.tsx",
    "src/components/CounterpartySearch.tsx",
  ]);
  const TEST_FILE = /(?:\.test\.|\.spec\.|__tests__|_test\.ts$|smoke_test\.ts$|src[\/\\]tests[\/\\])/;

  const BANNED_LABELS: Array<{ re: RegExp; label: string }> = [
    { re: /["']verified_registry["']/, label: "verified_registry source" },
    { re: /["']Verified registry["']/, label: "Verified registry label" },
    { re: /["']Verified entity["']/, label: "Verified entity coherence factor" },
  ];

  it("no customer-facing file reintroduces a counterparties.verified-derived trust label", () => {
    const offences: string[] = [];
    for (const root of CUSTOMER_FACING_ROOTS) {
      for (const f of walk(root)) {
        const rel = f.slice(ROOT.length + 1).split("\\").join("/");
        if (TEST_FILE.test(rel)) continue;
        if (CUSTOMER_FACING_EXEMPT.some((p) => rel.startsWith(p))) continue;
        if (LEGACY_ALIAS_ALLOWED.has(rel)) continue;
        const src = readFileSync(f, "utf8");
        for (const b of BANNED_LABELS) {
          if (b.re.test(src)) offences.push(`${rel}: ${b.label}`);
        }
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });
});
