/**
 * Batch V-UI — VerifyNow client-boundary guard.
 *
 * No frontend file may import the VerifyNow adapter, reference its
 * secret env var name, or import from supabase/functions/_shared/verifynow.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
const NEW_UI_ROOTS = [
  "src/components/idv",
  "src/pages/desk/idv",
  "src/pages/admin/idv",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("Batch V-UI — VerifyNow client boundary", () => {
  it("no frontend file references VERIFYNOW_API_KEY", () => {
    for (const f of walk(ROOT)) {
      const src = readFileSync(f, "utf8");
      expect(src.includes("VERIFYNOW_API_KEY"), `Secret ref in ${f}`).toBe(false);
    }
  });

  it("no new IDV UI file imports the VerifyNow adapter or shared server folder", () => {
    for (const root of NEW_UI_ROOTS) {
      for (const f of walk(root)) {
        const src = readFileSync(f, "utf8");
        expect(src.includes("_shared/verifynow"), `${f} imports verifynow adapter`).toBe(false);
        expect(src.includes("verifynow/adapter"), `${f} imports verifynow adapter`).toBe(false);
      }
    }
  });
});
