#!/usr/bin/env node
// P-5 Batch 2 — memory safety guard: notification outputs only emit safe
// references/outcomes — no raw sensitive payloads in default content.
import { readFileSync } from "node:fs";
const t = readFileSync("src/lib/p5-batch2/notifications.ts", "utf8");
const forbidden = ["passport_number", "bank_account_number", "fraud_flag", "raw_response"];
let bad = forbidden.filter((f) => t.includes(f));
if (bad.length) { console.error("memory-safety: leaks", bad); process.exit(1); }
console.log("memory-safety: OK");
