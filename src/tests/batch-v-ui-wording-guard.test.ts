/**
 * Batch V-UI — wording guard.
 *
 * Ensures no user/funder-facing IDV UI file introduces banned trust
 * signals such as "verified", "cleared", "approved", "passed",
 * "risk-free", "KYB cleared", "company verified", "sanctions clear",
 * "live-provider verified", or "compliance approved".
 *
 * Whitelisted context: the word "verification" (the noun) is required
 * wording. The banned list only matches the standalone completed-state
 * words.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { IDV_BANNED_WORDING } from "@/components/idv/idv-status-labels";

const UI_FILES = [
  "src/components/idv/idv-status-labels.ts",
  "src/components/idv/IdvStatusWidget.tsx",
  "src/components/idv/IdvBlockerNotice.tsx",
  "src/components/idv/FunderIdvSummary.tsx",
  "src/pages/desk/idv/IdvStart.tsx",
  "src/pages/admin/idv/IdvReviewQueue.tsx",
  "src/pages/admin/idv/IdvReviewCase.tsx",
];

// Words like "verification" are OK; only the exact banned tokens are
// forbidden as standalone words / short phrases.
const BANNED_REGEXES = IDV_BANNED_WORDING.map(
  (w) => new RegExp(`\\b${w.replace(/[-\/]/g, "[-\\/]")}\\b`, "i"),
);

describe("Batch V-UI — banned wording guard", () => {
  for (const file of UI_FILES) {
    it(`does not contain banned wording in ${file}`, () => {
      const content = readFileSync(join(process.cwd(), file), "utf8");
      // strip comments so guidance strings in JSDoc / // don't false-positive
      const codeOnly = content
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/IDV_BANNED_WORDING[\s\S]*?\]\)/g, ""); // ignore the SSOT list

      for (const rgx of BANNED_REGEXES) {
        expect(
          rgx.test(codeOnly),
          `Banned wording ${rgx} found in ${file}`,
        ).toBe(false);
      }
    });
  }
});
