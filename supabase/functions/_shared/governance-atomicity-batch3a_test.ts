/**
 * Governance Record Atomicity — Batch 3A (Disputes + Legal Hold)
 *
 * Static adoption tests proving that:
 *  - match-challenges raise/transition route through atomic_dispute_open
 *    and atomic_dispute_transition with p_governance,
 *  - admin-legal-hold apply/release route through atomic_legal_hold_apply
 *    and atomic_legal_hold_release with p_governance,
 *  - happy paths do not duplicate the canonical event via the TS writer,
 *  - missing governance_event_id fails closed,
 *  - dispute-governance/v1 and legal-hold/v1 policy versions are stamped.
 *
 * Live transactional rollback proof requires a live Postgres harness and
 * is NOT exercised here (same disclaimer as Batches 1 and 2).
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

// ── Dispute adoption ────────────────────────────────────────────────────────

Deno.test("match-challenges raise routes through atomic_dispute_open with p_governance", async () => {
  const src = await read("match-challenges/index.ts");
  assert(/admin\.rpc\(\s*"atomic_dispute_open"/.test(src), "must call admin.rpc(\"atomic_dispute_open\")");
  assertStringIncludes(src, "p_governance: disputeOpenGovPayload");
  assertStringIncludes(src, "disputeOpenGovPayload");
  assertStringIncludes(src, "dispute.opened");
});

Deno.test("match-challenges raise does not TS-write duplicate dispute.opened on happy path", async () => {
  const src = await read("match-challenges/index.ts");
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"dispute\.opened"/s.test(src),
    "match-challenges raise must not double-write dispute.opened via TS writer",
  );
});

Deno.test("match-challenges raise fails closed when atomic_dispute_open omits governance_event_id", async () => {
  const src = await read("match-challenges/index.ts");
  assertStringIncludes(src, "openR.governance_event_id");
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "Challenge raise rolled back");
});

Deno.test("match-challenges transition routes through atomic_dispute_transition with p_governance on terminal", async () => {
  const src = await read("match-challenges/index.ts");
  assert(/admin\.rpc\(\s*"atomic_dispute_transition"/.test(src), "must call admin.rpc(\"atomic_dispute_transition\")");
  assertStringIncludes(src, "disputeTransitionGovPayload");
  assertStringIncludes(src, "p_governance: disputeTransitionGovPayload");
  assertStringIncludes(src, "dispute.released");
  assertStringIncludes(src, "dispute.closed");
});

Deno.test("match-challenges transition does not TS-write duplicate dispute.closed/released on happy path", async () => {
  const src = await read("match-challenges/index.ts");
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"dispute\.closed"/s.test(src),
    "must not double-write dispute.closed via TS writer",
  );
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"dispute\.released"/s.test(src),
    "must not double-write dispute.released via TS writer",
  );
});

Deno.test("match-challenges transition fails closed when atomic RPC omits governance_event_id (terminal)", async () => {
  const src = await read("match-challenges/index.ts");
  assertStringIncludes(src, "tR.governance_event_id");
  assertStringIncludes(src, "Challenge transition rolled back");
});

Deno.test("match-challenges dispute payloads stamp dispute-governance/v1 policy version", async () => {
  const src = await read("match-challenges/index.ts");
  assertStringIncludes(src, "policy_version: DISPUTE_POLICY_VERSION");
  const policies = await read("_shared/governance-policy-versions.ts");
  assertStringIncludes(policies, 'DISPUTE_POLICY_VERSION = "dispute-governance/v1"');
});

// ── Legal hold adoption ─────────────────────────────────────────────────────

Deno.test("admin-legal-hold apply routes through atomic_legal_hold_apply with p_governance", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assert(/admin\.rpc\(\s*\n\s*"atomic_legal_hold_apply"/.test(src) ||
         /admin\.rpc\(\s*"atomic_legal_hold_apply"/.test(src),
         "must call admin.rpc(\"atomic_legal_hold_apply\")");
  assertStringIncludes(src, "legalHoldApplyGovPayload");
  assertStringIncludes(src, "p_governance: legalHoldApplyGovPayload");
});

Deno.test("admin-legal-hold apply does not TS-write duplicate legal_hold.applied on happy path", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"legal_hold\.applied"/s.test(src),
    "must not double-write legal_hold.applied via TS writer",
  );
});

Deno.test("admin-legal-hold apply fails closed when atomic RPC omits governance_event_id", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assertStringIncludes(src, "aR.governance_event_id");
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "Hold rolled back");
});

Deno.test("admin-legal-hold release routes through atomic_legal_hold_release with p_governance", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assert(/admin\.rpc\(\s*\n?\s*"atomic_legal_hold_release"/.test(src),
         "must call admin.rpc(\"atomic_legal_hold_release\")");
  assertStringIncludes(src, "legalHoldReleaseGovPayload");
  assertStringIncludes(src, "p_governance: legalHoldReleaseGovPayload");
});

Deno.test("admin-legal-hold release does not TS-write duplicate legal_hold.released on happy path", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"legal_hold\.released"/s.test(src),
    "must not double-write legal_hold.released via TS writer",
  );
});

Deno.test("admin-legal-hold release fails closed when atomic RPC omits governance_event_id", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assertStringIncludes(src, "rR.governance_event_id");
  assertStringIncludes(src, "Hold release rolled back");
});

Deno.test("admin-legal-hold payloads stamp legal-hold/v1 policy version", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assertStringIncludes(src, "policy_version: LEGAL_HOLD_POLICY_VERSION");
  const policies = await read("_shared/governance-policy-versions.ts");
  assertStringIncludes(policies, 'LEGAL_HOLD_POLICY_VERSION = "legal-hold/v1"');
});

// ── Migration shape ─────────────────────────────────────────────────────────

Deno.test("Batch 3A migration defines all four atomic RPCs with service_role-only grant", async () => {
  const dir = new URL("../../migrations/", import.meta.url);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".sql")) files.push(e.name);
  }
  let found = "";
  for (const name of files) {
    const body = await Deno.readTextFile(new URL(name, dir));
    if (body.includes("atomic_dispute_open") && body.includes("atomic_legal_hold_apply")) {
      found = body;
      break;
    }
  }
  assert(found.length > 0, "Batch 3A migration must exist");
  for (const fn of [
    "atomic_dispute_open",
    "atomic_dispute_transition",
    "atomic_legal_hold_apply",
    "atomic_legal_hold_release",
  ]) {
    assertStringIncludes(found, `CREATE OR REPLACE FUNCTION public.${fn}`);
    assertStringIncludes(found, `REVOKE ALL ON FUNCTION public.${fn}`);
    assertStringIncludes(found, `GRANT  EXECUTE ON FUNCTION public.${fn}(jsonb, jsonb) TO service_role`);
  }
  // All four RPCs invoke gov_emit_event inside the transaction.
  const govEmitCount = (found.match(/public\.gov_emit_event/g) ?? []).length;
  assert(govEmitCount >= 4, `expected >=4 gov_emit_event calls in migration, got ${govEmitCount}`);
});
