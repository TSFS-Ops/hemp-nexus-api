/**
 * Phase 2 Writer Adoption — P3-P7 static live-flow tests.
 * Asserts execution, dispute, payment, finality, legal-hold flows now
 * call the canonical writer with controlled taxonomy and fail-closed.
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

Deno.test("collapse wires execution.permitted + finality.recorded fail-closed", async () => {
  const src = await read("collapse/index.ts");
  assertStringIncludes(src, 'writeCriticalEventWithPosture');
  assertStringIncludes(src, '"execution.permitted"');
  assertStringIncludes(src, '"finality.recorded"');
  assertStringIncludes(src, 'source_function: "collapse"');
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "idempotency_extra: idempotency_key");
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

Deno.test("posture snapshot present at every new critical adoption site", async () => {
  for (const f of [
    "collapse/index.ts",
    "match-challenges/index.ts",
    "token-purchase/index.ts",
    "admin-legal-hold/index.ts",
  ]) {
    const src = await read(f);
    assert(/posture: buildPostureSnapshot\(/.test(src), `${f} must include buildPostureSnapshot`);
  }
});
