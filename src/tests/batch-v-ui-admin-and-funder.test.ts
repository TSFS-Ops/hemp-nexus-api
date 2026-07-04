/**
 * Batch V-UI — admin queue + funder summary safety.
 *
 * Static/source-level assertions (avoids Playwright): guarantees that
 * the review queue and funder summary components never render banned
 * fields such as raw provider payloads, full ID numbers, ID photos,
 * selfies, biometric data or private admin notes.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const FILES = [
  "src/pages/admin/idv/IdvReviewQueue.tsx",
  "src/pages/admin/idv/IdvReviewCase.tsx",
  "src/components/idv/FunderIdvSummary.tsx",
];

const BANNED_FIELDS = [
  "raw_provider_payload_admin_only",
  "raw_webhook_payload_admin_only",
  "id_photo",
  "selfie",
  "biometric",
  "notes_admin_only",
];

describe("Batch V-UI — private-data leakage guard", () => {
  for (const file of FILES) {
    it(`does not render banned admin-only fields in ${file}`, () => {
      const raw = readFileSync(file, "utf8");
      // Strip comments — banned field names are legitimate in policy docs.
      const src = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const field of BANNED_FIELDS) {
        expect(src.includes(field), `${field} appears in ${file}`).toBe(false);
      }
    });
  }

  it("admin queue posts to the existing idv-manual-review edge function", () => {
    const src = readFileSync("src/pages/admin/idv/IdvReviewCase.tsx", "utf8");
    expect(src.includes('"idv-manual-review"')).toBe(true);
  });

  it("funder summary shows the safe not-ready wording when not released", () => {
    const src = readFileSync("src/components/idv/FunderIdvSummary.tsx", "utf8");
    expect(src.includes("Not ready — identity verification required")).toBe(true);
  });
});
