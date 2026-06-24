#!/usr/bin/env node
// P-5 Batch 2 — audit guard: every material RPC + notification trigger
// must have an audit_action tag.
import { readFileSync } from "node:fs";
const txt = readFileSync("src/lib/p5-batch2/notifications.ts", "utf8");
const triggers = ["evidence_requested","evidence_uploaded","evidence_accepted","evidence_accepted_with_warning","evidence_rejected","mandatory_evidence_missing","evidence_expired","evidence_expiring","bank_details_changed","high_risk_ubo_evidence","provider_dependent_evidence","suspected_fraud_or_tampering","replacement_uploaded"];
let bad = [];
for (const t of triggers) {
  if (!txt.includes(`p5b2.notif.${t}`)) bad.push(`missing audit_action for ${t}`);
}
if (bad.length) { console.error("audit:\n" + bad.join("\n")); process.exit(1); }
console.log("audit: OK");
