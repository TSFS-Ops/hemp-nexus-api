/**
 * Batch O — IDV/KYB critical lockout: client-side wording + containment guards.
 *
 * Sibling to the Deno smoke test at
 * `supabase/functions/idv-verify/o_production_lockout_smoke_test.ts`.
 *
 * This suite proves:
 *   - EvidencePackView no longer uses the misleading "cleared/reviewed"
 *     wording that motivated Batch O Part 2, and now uses the neutral
 *     "KYB evidence recorded" / "Jurisdiction and sanctions evidence
 *     recorded" labels.
 *   - No customer-facing component uses `counterparties.verified` as a
 *     proof-of-verification signal (schema-level REVOKE remains deferred
 *     as a separate governance decision — this guard prevents UI drift
 *     from silently re-introducing the risk).
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

describe("Batch O Part 3 — counterparties.verified containment (UI layer)", () => {
  // Recursively collect .ts/.tsx files under a directory.
  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return out; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(full);
    }
    return out;
  }

  const files = walk(join(ROOT, "src", "components"))
    .concat(walk(join(ROOT, "src", "pages")));

  // Any occurrence of `counterparty.verified` / `counterparties.verified`
  // treated as a truthiness signal for verification proof in a
  // customer-facing surface is forbidden. Admin-only surfaces are
  // exempt (schema-level REVOKE is the separate deferred proposal).
  const CUSTOMER_FACING_EXEMPT = [
    join("src", "components", "admin"),
    join("src", "pages", "admin"),
    join("src", "components", "developer"),
    join("src", "components", "governance"),
    join("src", "pages", "GovernanceAudits"),
    join("src", "pages", "GovernanceEntities"),
    join("src", "pages", "GovernanceHealth"),
    join("src", "pages", "GovernanceTriage"),
  ];

  const FORBIDDEN_ACCESSORS = [
    /\bcounterparty\?\.verified\b/,
    /\bcounterparty\.verified\b/,
    /\bcounterparties\?\.verified\b/,
    /\bcounterparties\.verified\b/,
    /\bcp\.verified\b/,
    /\brow\.verified\b(?=[\s\S]{0,80}counterpart)/,
  ];

  it("no customer-facing component reads counterparties.verified as proof", () => {
    const offences: string[] = [];
    for (const f of files) {
      const rel = f.slice(ROOT.length + 1);
      if (CUSTOMER_FACING_EXEMPT.some((p) => rel.startsWith(p))) continue;
      const src = readFileSync(f, "utf8");
      for (const re of FORBIDDEN_ACCESSORS) {
        if (re.test(src)) offences.push(`${rel}: ${re}`);
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });
});
