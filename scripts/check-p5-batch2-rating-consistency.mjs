#!/usr/bin/env node
// P-5 Batch 2 — rating enum consistency guard.
import { readFileSync } from "node:fs";
const c = readFileSync("src/lib/p5-batch2/constants.ts", "utf8");
const m = c.match(/P5B2_EVIDENCE_RATINGS = \[([\s\S]*?)\] as const/);
if (!m) { console.error("rating-consistency: SSOT not found"); process.exit(1); }
const ratings = [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
const required = ["strong", "good", "acceptable", "weak", "unusable", "provider_dependent"];
const missing = required.filter((r) => !ratings.includes(r));
if (missing.length) { console.error("rating-consistency: missing", missing); process.exit(1); }
console.log("rating-consistency: OK", ratings.length, "ratings");
