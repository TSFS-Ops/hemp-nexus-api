/**
 * Batch V — Client boundary tests for the VerifyNow adapter.
 *
 * Proves:
 *  - VERIFYNOW_API_KEY is never referenced in src/**.
 *  - Adapter file at supabase/functions/_shared/verifynow/adapter.ts is
 *    never imported from src/**.
 *  - The base URL / mode / key are only read from Deno.env in the server
 *    adapter — never via import.meta.env in the browser.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("Batch V — VerifyNow client boundary", () => {
  const srcFiles = walk("src").filter(
    (f) => !f.includes("__tests__") && !/\.test\.ts$/.test(f),
  );

  it("VERIFYNOW_API_KEY is not referenced anywhere in src/**", () => {
    const offenders: string[] = [];
    for (const f of srcFiles) {
      const c = readFileSync(f, "utf8");
      if (/VERIFYNOW_API_KEY/.test(c)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("VerifyNow adapter file is not imported from src/**", () => {
    const offenders: string[] = [];
    for (const f of srcFiles) {
      const c = readFileSync(f, "utf8");
      if (/verifynow\/adapter/.test(c)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("no client code reads VERIFYNOW_* via import.meta.env", () => {
    const offenders: string[] = [];
    for (const f of srcFiles) {
      const c = readFileSync(f, "utf8");
      if (/import\.meta\.env[^;]*VERIFYNOW/.test(c)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
