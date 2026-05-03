#!/usr/bin/env node
/**
 * Doc lint: fail if customer-facing ZAR billing strings reappear in public/docs.
 *
 * Billing/credits/pricing on the platform is USD-native (1 credit = $1).
 * Trade options may still be quoted in any currency (ZAR, EUR, etc.) — that is
 * a commercial term, not a billing claim — so we only flag patterns that look
 * like billing/pricing/credits expressed in Rand.
 *
 * To intentionally allow a line, append the marker:  // zar-billing-allow
 * (or <!-- zar-billing-allow --> in markdown).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(process.cwd(), 'public', 'docs');
const ALLOW_MARKER = 'zar-billing-allow';

// Patterns that indicate ZAR-denominated *billing/pricing/credits*.
// We deliberately avoid matching bare "ZAR" in trade-option payload examples.
const PATTERNS = [
  // "R 1,000" / "R1000" near billing words on the same line
  /\bR\s?\d[\d,\.]*\s*(?:per|\/)?\s*(?:credit|credits|pack|tier|plan|month|user|seat|invoice|topup|top-up)\b/i,
  // Currency-word billing: "ZAR 10 per credit", "Rand pricing", "in Rand"
  /\b(?:ZAR|Rand|Rands)\b[^\n]{0,80}\b(?:credit|credits|pricing|price|billing|invoice|tier|pack|plan|topup|top-up|settlement|settle|charged|charge)\b/i,
  /\b(?:credit|credits|pricing|price|billing|invoice|tier|pack|plan|topup|top-up|settlement|settle|charged|charge)\b[^\n]{0,80}\b(?:ZAR|Rand|Rands)\b/i,
  // Paystack settling in ZAR (we settle in USD now)
  /\bPaystack\b[^\n]{0,40}\b(?:ZAR|Rand)\b/i,
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(md|mdx|txt|html?)$/i.test(entry)) out.push(p);
  }
  return out;
}

let failures = 0;
let scanned = 0;

let files = [];
try {
  files = walk(ROOT);
} catch {
  console.log(`[check-docs-no-zar-billing] ${relative(process.cwd(), ROOT)} not found — skipping.`);
  process.exit(0);
}

for (const file of files) {
  scanned++;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW_MARKER)) return;
    for (const re of PATTERNS) {
      if (re.test(line)) {
        failures++;
        console.error(
          `✗ ${relative(process.cwd(), file)}:${i + 1}  ${line.trim()}`,
        );
        break;
      }
    }
  });
}

if (failures > 0) {
  console.error(
    `\n[check-docs-no-zar-billing] FAIL — ${failures} customer-facing ZAR billing string(s) found in public/docs.\n` +
      `Billing is USD-native (1 credit = $1). Use USD pricing in customer docs, or append "// ${ALLOW_MARKER}" to intentionally allow a line.`,
  );
  process.exit(1);
}

console.log(
  `[check-docs-no-zar-billing] OK — scanned ${scanned} doc file(s), no ZAR billing strings found.`,
);
