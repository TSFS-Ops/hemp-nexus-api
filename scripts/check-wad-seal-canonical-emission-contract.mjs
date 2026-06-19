#!/usr/bin/env node
/**
 * Governance Record Batch 2 — WaD Seal Canonical Emission Contract.
 *
 * Prebuild guard. Fails the build if:
 *   - wad/index.ts does not emit canonical `wad.passed` on the UI seal path,
 *   - emits it more than once,
 *   - emits `wad.failed` from the UI seal path (Batch 2 scope),
 *   - removes the existing audit_logs / basic-memory / revenue-notify hooks,
 *   - event_store payload references canonical_payload_json,
 *   - idempotency key is missing or unstable,
 *   - p3-wad/index.ts gains TS-level duplicate writers for wad.passed/failed,
 *   - introduces a migration, cron, RLS change, new RPC, or fail-closed seal
 *     path (atomic_wad_seal) inside wad/index.ts.
 *
 * Static source guard only — no runtime, no DB.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const WAD = readFileSync(resolve(ROOT, "supabase/functions/wad/index.ts"), "utf8");
const P3 = readFileSync(resolve(ROOT, "supabase/functions/p3-wad/index.ts"), "utf8");

const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

// 1. wad.passed emitted exactly once.
const passedMatches = WAD.match(/event_type:\s*"wad\.passed"/g) ?? [];
ok(passedMatches.length === 1,
   `wad/index.ts must emit event_type:"wad.passed" exactly once on the seal path (found ${passedMatches.length}).`);

// 2. wad.failed must NOT be emitted from the UI seal path in Batch 2.
ok(!/event_type:\s*"wad\.failed"/.test(WAD),
   `Batch 2 forbids emitting event_type:"wad.failed" from wad/index.ts.`);

// 3. Stable idempotency key.
ok(/idempotency_key:\s*`\$\{wadId\}\|wad\.passed\|seal`/.test(WAD),
   `wad/index.ts must use stable idempotency_key \`\${wadId}|wad.passed|seal\`.`);

// 4. aggregate_type must be "wad".
ok(/aggregate_type:\s*"wad"/.test(WAD),
   `wad/index.ts wad.passed emission must use aggregate_type:"wad".`);

// 5. Uses best-effort controlled writer (NOT critical / fail-closed).
ok(/writeGovernanceEventBestEffort\s*\(/.test(WAD),
   `wad/index.ts must use writeGovernanceEventBestEffort for the wad.passed emission.`);
ok(!/writeCriticalGovernanceEvent\s*\(/.test(WAD),
   `Batch 2 forbids writeCriticalGovernanceEvent in wad/index.ts (fail-closed seal is deferred to atomic_wad_seal).`);
ok(!/writeCriticalEventWithPosture\s*\(/.test(WAD),
   `Batch 2 forbids writeCriticalEventWithPosture in wad/index.ts (fail-closed seal is deferred to atomic_wad_seal).`);

// 6. Policy version stamped.
ok(/WAD_POLICY_VERSION/.test(WAD),
   `wad/index.ts must stamp WAD_POLICY_VERSION in the posture_snapshot and metadata.`);

// 7. Payload must NOT reference canonical_payload_json.
const passedStart = WAD.search(/event_type:\s*"wad\.passed"/);
if (passedStart >= 0) {
  const block = WAD.slice(passedStart, passedStart + 2000);
  ok(!/canonical_payload_json/.test(block),
     `wad.passed payload/metadata must not reference canonical_payload_json.`);
}

// 8. Legacy hooks preserved.
ok(/writeAuditLog\("wad\.sealed",\s*wadId/.test(WAD),
   `wad/index.ts must retain writeAuditLog("wad.sealed", wadId, …).`);
ok(/writeBasicMemoryRecord\b/.test(WAD),
   `wad/index.ts must retain the basic-memory best-effort hook.`);
ok(/emitRevenueNotification\b/.test(WAD),
   `wad/index.ts must retain the revenue-notify hook.`);

// 9. Ordering: wads UPDATE → writeAuditLog("wad.sealed") → wad.passed → basic-memory → revenue-notify.
const idxUpdate  = WAD.search(/status:\s*"sealed"/);
const idxAudit   = WAD.search(/writeAuditLog\("wad\.sealed"/);
const idxPassed  = WAD.search(/event_type:\s*"wad\.passed"/);
const idxMemory  = WAD.search(/trigger_event_type:\s*"wad\.sealed"/);
const idxRevenue = WAD.search(/eventType:\s*"wad_sealed"/);
ok(idxUpdate >= 0 && idxAudit > idxUpdate,
   `writeAuditLog("wad.sealed", …) must follow the wads UPDATE to status='sealed'.`);
ok(idxAudit >= 0 && idxPassed > idxAudit,
   `wad.passed event_store write must follow writeAuditLog("wad.sealed", …).`);
ok(idxPassed >= 0 && idxMemory > idxPassed,
   `basic-memory hook must follow the wad.passed event_store write.`);
ok(idxPassed >= 0 && idxRevenue > idxPassed,
   `revenue-notify hook must follow the wad.passed event_store write.`);

// 10. No new fail-closed seal path / no atomic_wad_seal in wad/index.ts.
ok(!/atomic_wad_seal/.test(WAD),
   `Batch 2 forbids introducing atomic_wad_seal in wad/index.ts (deferred to a future batch).`);

// 11. Out-of-scope changes inside wad/index.ts: no new RPC, no migration, no RLS keywords.
ok(!/\.rpc\(\s*"atomic_wad_(seal|issue|deny)"/.test(WAD),
   `wad/index.ts must not invoke atomic_wad_* RPCs.`);

// 12. p3-wad must not gain TS-level duplicate wad.passed/wad.failed writers.
const dupPatterns = [
  /writeGovernanceEventBestEffort\([^)]*event_type:\s*"wad\.passed"/s,
  /writeCriticalEventWithPosture\([^)]*event_type:\s*"wad\.passed"/s,
  /writeCriticalGovernanceEvent\([^)]*event_type:\s*"wad\.passed"/s,
  /writeGovernanceEventBestEffort\([^)]*event_type:\s*"wad\.failed"/s,
  /writeCriticalEventWithPosture\([^)]*event_type:\s*"wad\.failed"/s,
  /writeCriticalGovernanceEvent\([^)]*event_type:\s*"wad\.failed"/s,
];
for (const p of dupPatterns) {
  ok(!p.test(P3),
     `p3-wad/index.ts must NOT add a duplicate TS-level writer for wad.passed/wad.failed (atomic RPC already emits these).`);
}

if (errors.length) {
  console.error("✗ WaD seal canonical emission contract failed:\n");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
console.log("✓ WaD seal canonical emission contract OK (Governance Record Batch 2).");
