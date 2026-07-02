/**
 * Batch V — Person-only scope proof.
 *
 * A successful VerifyNow IDV result affects the PERSON layer only. It
 * must not flip any of:
 *   - entities.status = 'verified'
 *   - counterparties.verified = true
 *   - funder-ready
 *   - finality
 *   - API ready=true
 *
 * This test scans the new Batch V surfaces (`src/lib/idv/**`,
 * `supabase/functions/_shared/verifynow/**`,
 * `supabase/functions/_shared/idv-gate.ts`,
 * `supabase/functions/_shared/idv-wad-seal-gate.ts`,
 * `supabase/functions/idv-manual-review/index.ts`) for any code that
 * writes those company-level trust signals.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FILES = [
  ...walk("src/lib/idv"),
  ...walk("supabase/functions/_shared/verifynow"),
  "supabase/functions/_shared/idv-gate.ts",
  "supabase/functions/_shared/idv-wad-seal-gate.ts",
  "supabase/functions/_shared/idv-manual-review-shape.ts",
  "supabase/functions/idv-manual-review/index.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p, out);
      else if (/\.ts$/.test(name)) out.push(p);
    }
  } catch { /* dir absent */ }
  return out;
}

describe("Batch V — person-only scope", () => {
  const bannedWrites = [
    /\.update\s*\(\s*\{[^}]*verified\s*:\s*true/s,
    /\.update\s*\(\s*\{[^}]*status\s*:\s*['"]verified['"]/s,
    /\.update\s*\(\s*\{[^}]*funder_ready\s*:\s*true/s,
    /\.update\s*\(\s*\{[^}]*finality_ready\s*:\s*true/s,
    /ready\s*:\s*true/,
    /entities.*status.*verified/i,
    /counterparties.*verified\s*:\s*true/i,
  ];

  it.each(FILES)("%s does not flip company/funder/finality/API to verified/ready=true", (file) => {
    const c = readFileSync(file, "utf8");
    for (const pat of bannedWrites) {
      expect(c, `pattern ${pat}`).not.toMatch(pat);
    }
  });
});
