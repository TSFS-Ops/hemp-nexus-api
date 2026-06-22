#!/usr/bin/env node
/**
 * Batch 26 — Guard: browser SSOT and Deno SSOT for the search/profile/
 * corrections operating rules must be byte-identical. Both halves of
 * the platform reason from the same client decisions.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const a = readFileSync("src/lib/registry-search-profile-rules.ts");
const b = readFileSync(
  "supabase/functions/_shared/registry-search-profile-rules.ts",
);
const ha = createHash("sha256").update(a).digest("hex");
const hb = createHash("sha256").update(b).digest("hex");

if (ha !== hb) {
  console.error(
    "❌ Batch 26 SSOT parity FAILED:\n" +
      `  src/lib/registry-search-profile-rules.ts                       sha256=${ha}\n` +
      `  supabase/functions/_shared/registry-search-profile-rules.ts    sha256=${hb}\n` +
      "  Copy the browser SSOT verbatim to the Deno mirror.",
  );
  process.exit(1);
}
console.log("✓ Batch 26 search/profile/corrections SSOT parity OK");
