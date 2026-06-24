#!/usr/bin/env node
// P-5 Batch 2 — readiness bridge guard: ensure key readiness dimensions exist.
import { readFileSync } from "node:fs";
const t = readFileSync("src/lib/p5-batch2/readiness-bridge.ts", "utf8");
const required = ["kyb","kyc","governance","compliance","bankability","execution","finality","funder_pack","api"];
let bad = required.filter((d) => !t.includes(`"${d}"`));
if (bad.length) { console.error("readiness-bridge: missing dims", bad); process.exit(1); }
console.log("readiness-bridge: OK");
