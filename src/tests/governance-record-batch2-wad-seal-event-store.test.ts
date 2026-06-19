/**
 * Governance Record Batch 2 — WaD Seal Event-Store Wiring (static source guard).
 *
 * Asserts that the UI seal path in `supabase/functions/wad/index.ts` emits a
 * canonical `wad.passed` event into event_store via the controlled-taxonomy
 * best-effort writer, AFTER the wads UPDATE to status='sealed' and AFTER
 * `writeAuditLog("wad.sealed", …)`, and BEFORE the basic-memory and
 * revenue-notify hooks. The path remains best-effort / fail-open — full
 * fail-closed seal enforcement is deferred to a future atomic_wad_seal batch.
 *
 * The test is purely textual on the source file; no DB, no runtime.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const WAD_SRC = readFileSync(
  resolve(process.cwd(), "supabase/functions/wad/index.ts"),
  "utf8",
);
const P3_WAD_SRC = readFileSync(
  resolve(process.cwd(), "supabase/functions/p3-wad/index.ts"),
  "utf8",
);

function indexOfOrFail(haystack: string, needle: string | RegExp): number {
  const idx =
    typeof needle === "string"
      ? haystack.indexOf(needle)
      : haystack.search(needle);
  if (idx < 0) {
    throw new Error(`expected to find: ${String(needle)}`);
  }
  return idx;
}

describe("Governance Record Batch 2 — wad/index.ts UI seal path emits wad.passed", () => {
  it("imports the best-effort controlled writer + WAD_POLICY_VERSION", () => {
    expect(WAD_SRC).toMatch(
      /from\s+"\.\.\/_shared\/governance-audit-integration\.ts"/,
    );
    expect(WAD_SRC).toMatch(/writeGovernanceEventBestEffort/);
    expect(WAD_SRC).toMatch(/buildPostureSnapshot/);
    expect(WAD_SRC).toMatch(
      /from\s+"\.\.\/_shared\/governance-policy-versions\.ts"/,
    );
    expect(WAD_SRC).toMatch(/WAD_POLICY_VERSION/);
  });

  it("emits event_type: \"wad.passed\" exactly once on the seal path", () => {
    const matches = WAD_SRC.match(/event_type:\s*"wad\.passed"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("does NOT emit event_type: \"wad.failed\" from the UI seal path (Batch 2 scope)", () => {
    expect(WAD_SRC).not.toMatch(/event_type:\s*"wad\.failed"/);
  });

  it("uses aggregate_type: \"wad\" and the stable idempotency key", () => {
    expect(WAD_SRC).toMatch(/aggregate_type:\s*"wad"/);
    expect(WAD_SRC).toMatch(
      /idempotency_key:\s*`\$\{wadId\}\|wad\.passed\|seal`/,
    );
  });

  it("stamps WAD_POLICY_VERSION in posture_snapshot and metadata", () => {
    const block = WAD_SRC.slice(
      indexOfOrFail(WAD_SRC, /event_type:\s*"wad\.passed"/),
      indexOfOrFail(WAD_SRC, /event_type:\s*"wad\.passed"/) + 2000,
    );
    expect(block).toMatch(
      /buildPostureSnapshot\(\s*"Standard"[\s\S]*policy_version:\s*WAD_POLICY_VERSION/,
    );
    expect(block).toMatch(/metadata:[\s\S]*policy_version:\s*WAD_POLICY_VERSION/);
  });

  it("payload excludes canonical_payload_json contents", () => {
    const start = indexOfOrFail(WAD_SRC, /event_type:\s*"wad\.passed"/);
    const block = WAD_SRC.slice(start, start + 2000);
    expect(block).not.toMatch(/canonical_payload_json/);
  });

  it("orders the event_store write after the wads UPDATE + writeAuditLog and before basic-memory + revenue-notify", () => {
    const updateIdx = indexOfOrFail(WAD_SRC, /status:\s*"sealed"/);
    const auditIdx = indexOfOrFail(
      WAD_SRC,
      /writeAuditLog\("wad\.sealed"/,
    );
    const passedIdx = indexOfOrFail(WAD_SRC, /event_type:\s*"wad\.passed"/);
    const memoryIdx = indexOfOrFail(
      WAD_SRC,
      /trigger_event_type:\s*"wad\.sealed"/,
    );
    const revenueIdx = indexOfOrFail(
      WAD_SRC,
      /eventType:\s*"wad_sealed"/,
    );
    expect(updateIdx).toBeLessThan(auditIdx);
    expect(auditIdx).toBeLessThan(passedIdx);
    expect(passedIdx).toBeLessThan(memoryIdx);
    expect(passedIdx).toBeLessThan(revenueIdx);
  });

  it("retains the legacy audit_logs / basic-memory / revenue-notify hooks", () => {
    expect(WAD_SRC).toMatch(/writeAuditLog\("wad\.sealed",\s*wadId/);
    expect(WAD_SRC).toMatch(/writeBasicMemoryRecord\b/);
    expect(WAD_SRC).toMatch(/emitRevenueNotification\b/);
  });

  it("does NOT introduce a new atomic_wad_seal RPC or fail-closed seal path", () => {
    expect(WAD_SRC).not.toMatch(/atomic_wad_seal/);
    expect(WAD_SRC).not.toMatch(/writeCriticalGovernanceEvent\s*\(/);
    expect(WAD_SRC).not.toMatch(/writeCriticalEventWithPosture\s*\(/);
  });
});

describe("Governance Record Batch 2 — p3-wad/index.ts is not double-written from TS", () => {
  it("p3-wad still has NO direct TS-level writeGovernanceEventBestEffort/Critical for wad.passed or wad.failed", () => {
    // Phase-3 atomic path emits wad.passed/wad.failed inside atomic_wad_issue
    // / atomic_wad_deny RPCs — TS callers must not duplicate that write.
    expect(P3_WAD_SRC).not.toMatch(
      /writeGovernanceEventBestEffort\([^)]*event_type:\s*"wad\.passed"/s,
    );
    expect(P3_WAD_SRC).not.toMatch(
      /writeCriticalEventWithPosture\([^)]*event_type:\s*"wad\.passed"/s,
    );
    expect(P3_WAD_SRC).not.toMatch(
      /writeCriticalGovernanceEvent\([^)]*event_type:\s*"wad\.passed"/s,
    );
    expect(P3_WAD_SRC).not.toMatch(
      /writeGovernanceEventBestEffort\([^)]*event_type:\s*"wad\.failed"/s,
    );
    expect(P3_WAD_SRC).not.toMatch(
      /writeCriticalEventWithPosture\([^)]*event_type:\s*"wad\.failed"/s,
    );
  });
});
