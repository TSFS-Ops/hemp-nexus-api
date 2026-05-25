/**
 * Phase 2 Writer Adoption — P3-P7 static live-flow tests.
 *
 * Asserts execution/finality, dispute, payment, and legal-hold flows are
 * canonically wired. After Atomicity Batch 1+2 cleanup, the collapse flow
 * routes through the atomic_collapse_record RPC instead of TS-side
 * writeCriticalEventWithPosture for execution.permitted / finality.recorded.
 * Other flows (disputes, payment exception, legal hold) still use the TS
 * writer pattern and remain sequential pending Batch 3.
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

Deno.test("collapse routes execution.permitted + finality.recorded through atomic_collapse_record (fail-closed)", async () => {
  const src = await read("collapse/index.ts");
  // Atomicity Batch 2: canonical writes happen inside the RPC, not TS.
  assertStringIncludes(src, 'atomic_collapse_record');
  assertStringIncludes(src, 'p_governance_execution: govExecution');
  assertStringIncludes(src, 'p_governance_finality: govFinality');
  assertStringIncludes(src, 'source_function: "collapse"');
  // Fail-closed: missing event IDs roll back.
  assertStringIncludes(src, 'collapseResult.execution_event_id');
  assertStringIncludes(src, 'collapseResult.finality_event_id');
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "Collapse rolled back");
  // Duplicate-write guard: no TS-side critical write for these canonical types.
  assert(
    !/writeCriticalEventWithPosture\(adminClient,\s*\{[^}]*event_type:\s*"execution\.permitted"/s.test(src),
    "collapse must not double-write execution.permitted via TS writer",
  );
  assert(
    !/writeCriticalEventWithPosture\(adminClient,\s*\{[^}]*event_type:\s*"finality\.recorded"/s.test(src),
    "collapse must not double-write finality.recorded via TS writer",
  );
});

Deno.test("match-challenges wires dispute.opened/closed/released fail-closed", async () => {
  const src = await read("match-challenges/index.ts");
  assertStringIncludes(src, '"dispute.opened"');
  assertStringIncludes(src, '"dispute.closed"');
  assertStringIncludes(src, '"dispute.released"');
  assertStringIncludes(src, 'source_function: "match-challenges"');
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
});

Deno.test("token-purchase webhook wires payment.event_created fail-closed", async () => {
  const src = await read("token-purchase/index.ts");
  assertStringIncludes(src, '"payment.event_created"');
  assertStringIncludes(src, 'source_function: "token-purchase/webhook"');
  assertStringIncludes(src, "payment_reference: reference");
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
});

Deno.test("admin-legal-hold wires legal_hold.applied + legal_hold.released fail-closed", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assertStringIncludes(src, '"legal_hold.applied"');
  assertStringIncludes(src, '"legal_hold.released"');
  assertStringIncludes(src, 'source_function: "admin-legal-hold"');
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
});

Deno.test("admin-hq-audit helper exists and requires reason + fail-closed wrapper", async () => {
  const src = await read("_shared/admin-hq-audit.ts");
  assertStringIncludes(src, "recordAdminHqDecision");
  assertStringIncludes(src, '"admin.hq_decision_recorded"');
  assertStringIncludes(src, "ADMIN_HQ_REASON_REQUIRED");
  assertStringIncludes(src, "writeCriticalEventWithPosture");
});

Deno.test("posture snapshot present at every critical adoption site", async () => {
  for (const f of [
    "collapse/index.ts",
    "match-challenges/index.ts",
    "token-purchase/index.ts",
    "admin-legal-hold/index.ts",
  ]) {
    const src = await read(f);
    // Accept either the TS-writer `posture:` field or the atomic-RPC
    // `posture_snapshot:` field inside a p_governance payload.
    assert(
      /posture(_snapshot)?:\s*buildPostureSnapshot\(/.test(src),
      `${f} must include buildPostureSnapshot`,
    );
  }
});
