#!/usr/bin/env node
/**
 * Batch D — prebuild guard. Fails CI if any callsite of `triggerWebhooks`
 * inside supabase/functions/** omits the `eventIdempotencyKey` option.
 *
 * The helper itself enforces this at runtime (refusing to deliver), but a
 * static check stops broken callsites from ever reaching the runtime in
 * the first place.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = "supabase/functions";
let files = [];
try {
  const out = execSync(
    `grep -rl --include='*.ts' 'triggerWebhooks(' ${ROOT}`,
    { encoding: "utf8" },
  );
  files = out.split("\n").filter(Boolean);
} catch {
  // grep exits non-zero when no match — that's fine.
}

// The helper file declares the function; skip it.
files = files.filter((f) => !f.endsWith("_shared/webhooks.ts"));

const failures = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match import alias lines and the helper export, but only flag
    // actual call expressions: `triggerWebhooks(` not at start of word.
    if (!/\btriggerWebhooks\s*\(/.test(line)) continue;
    // Skip import lines.
    if (/^\s*import\b/.test(line)) continue;

    // Find the matching closing paren by tracking depth across lines.
    const startIdx = line.indexOf("triggerWebhooks(");
    if (startIdx < 0) continue;
    let depth = 0;
    let buf = "";
    let scanning = false;
    let endLine = i;
    for (let j = i; j < Math.min(i + 80, lines.length); j++) {
      const seg = j === i ? lines[j].slice(startIdx) : lines[j];
      for (const ch of seg) {
        if (ch === "(") {
          depth++;
          scanning = true;
        } else if (ch === ")") {
          depth--;
        }
        buf += ch;
        if (scanning && depth === 0) {
          endLine = j;
          break;
        }
      }
      if (scanning && depth === 0) break;
    }

    if (!/eventIdempotencyKey\s*:/.test(buf)) {
      failures.push(`${file}:${i + 1} — triggerWebhooks(...) call missing eventIdempotencyKey`);
    }
    // Skip past this call expression.
    i = endLine;
  }
}

if (failures.length > 0) {
  console.error("\n❌ Batch D webhook idempotency check FAILED:");
  for (const f of failures) console.error("  " + f);
  console.error(
    "\nEvery triggerWebhooks(...) call must pass { eventIdempotencyKey: '<event>:<stable-id>' }.",
  );
  console.error(
    "Without it, retries and accidental double-fires can produce duplicate webhook deliveries.\n",
  );
  process.exit(1);
}

console.log(`✓ Batch D webhook idempotency: all ${files.length} caller file(s) clean.`);
