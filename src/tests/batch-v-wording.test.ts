/**
 * Batch V — Wording safety.
 *
 * The new Batch V surfaces must not contain any of the forbidden
 * external trust-signal phrases guarded by Batch O / Batch O Remainder.
 * Admin-only strings may reference the provider name (VerifyNow) and
 * technical statuses.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p, out);
      else if (/\.ts$/.test(name)) out.push(p);
    }
  } catch { /* absent */ }
  return out;
}

// External-user surfaces (browser).
const EXTERNAL_FILES = [
  "src/lib/idv/route-table.ts",
  "src/lib/idv/result-mapping.ts",
  "src/lib/idv/controlled-action-gate.ts",
  "src/lib/idv/manual-review.ts",
  "src/lib/idv/provider-registry.ts",
];

// Server surfaces that produce user-facing wording strings.
const SERVER_FILES = [
  "supabase/functions/_shared/verifynow/result-mapping.ts",
  "supabase/functions/_shared/idv-route-table.ts",
  "supabase/functions/_shared/idv-gate.ts",
  "supabase/functions/_shared/idv-wad-seal-gate.ts",
];

// Phrases banned on external surfaces. Case-insensitive, word-ish.
const BANNED = [
  /\bcleared\b/i,
  /\bpassed\b/i,
  /\bapproved\b/i,
  /\brisk[- ]free\b/i,
  /\bcompliance approved\b/i,
  /\bregulator approved\b/i,
  /\bsanctions clear\b/i,
  /\bprovider approved\b/i,
  /\bno adverse result\b/i,
  /\baml passed\b/i,
  /\bkyb cleared\b/i,
  /\bcompany verified\b/i,
];

// Extract user-facing string literals (`user_wording`, `label`,
// `helperText`, `message`) — we allow admin_wording to reference the
// provider name.
function extractExternalStrings(content: string): string[] {
  const out: string[] = [];
  const patterns = [
    /user_wording[^{]*\{[^}]*label:\s*"([^"]+)"/g,
    /user_wording[^{]*\{[^}]*hint:\s*"([^"]+)"/g,
    /user_wording:\s*"([^"]+)"/g,
    /message:\s*"([^"]+)"/g,
    /\bIDV_MANUAL_REVIEW_USER_WORDING[^}]*\}/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) out.push(m[1] ?? m[0]);
  }
  return out;
}

describe("Batch V — external wording safety", () => {
  it.each([...EXTERNAL_FILES, ...SERVER_FILES])(
    "%s has no banned external trust-signal phrases in user_wording/message strings",
    (file) => {
      const c = readFileSync(file, "utf8");
      const strings = extractExternalStrings(c);
      for (const s of strings) {
        for (const b of BANNED) {
          expect(s, `banned phrase ${b} in ${file}: "${s}"`).not.toMatch(b);
        }
      }
    },
  );

  it("provider registry lists only VerifyNow as active for new IDV", () => {
    const c = readFileSync("src/lib/idv/provider-registry.ts", "utf8");
    expect(c).toMatch(/ACTIVE_IDV_PROVIDERS = Object\.freeze\(\["verifynow"/);
    for (const p of ["dilisense", "onfido", "sumsub", "didit", "complycube"]) {
      // decommissioned list must include them
      expect(c).toContain(`"${p}"`);
    }
  });

  it("manual review shape has all seven decisions", () => {
    const c = readFileSync("src/lib/idv/manual-review.ts", "utf8");
    for (const d of [
      "manual_review_accepted",
      "manual_review_rejected",
      "more_information_required",
      "alternative_document_required",
      "provider_retry_required",
      "blocked_pending_admin_decision",
      "waived_with_reason",
    ]) {
      expect(c).toContain(`"${d}"`);
    }
  });
});
