/**
 * Governance Record Atomicity — Batch 2 (WaD + finality/collapse)
 *
 * Static adoption tests that prove the WaD decision path and the
 * collapse/finality path now route through atomic SECURITY DEFINER RPCs
 * (atomic_wad_issue, atomic_wad_deny, atomic_collapse_record), pass the
 * canonical governance payload as p_governance / p_governance_execution /
 * p_governance_finality, and fail closed when the RPC does not return a
 * governance_event_id.
 *
 * Live transactional-rollback proof (forcing gov_emit_event to throw
 * mid-RPC and observing the WaD / collapse row roll back) requires a live
 * Postgres harness and is NOT exercised here. The static contract below
 * proves wiring, payload shape, fail-closed branching, policy versions,
 * and duplicate-write prevention.
 */
import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

// ── WaD adoption ─────────────────────────────────────────────────────────────

Deno.test("p3-wad routes WaD issue through atomic_wad_issue with p_governance", async () => {
  const src = await read("p3-wad/index.ts");
  assert(/admin\.rpc\(\s*"atomic_wad_issue"/.test(src), "must call admin.rpc(\"atomic_wad_issue\")");

  assertStringIncludes(src, "p_governance: wadIssueGovPayload");
  assertStringIncludes(src, "wadIssueGovPayload");
  assertStringIncludes(src, 'event_type: "wad.passed"');
  // Edge fn must not also call the TS canonical writer for wad.passed on
  // happy path — guarded by checking there is no writeCriticalEventWithPosture
  // call site for wad.passed after the RPC.
  assert(
    !/writeCriticalEventWithPosture\([^)]*\n[^)]*event_type:\s*"wad\.passed"/s.test(src),
    "p3-wad must not double-write wad.passed via TS writer",
  );
});

Deno.test("p3-wad WaD issue fails closed when atomic_wad_issue omits governance_event_id", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(src, "wadIssueResult.governance_event_id");
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "WaD issue rolled back");
});

Deno.test("p3-wad routes WaD denial through atomic_wad_deny with p_governance", async () => {
  const src = await read("p3-wad/index.ts");
  assert(/admin\.rpc\(\s*"atomic_wad_deny"/.test(src), "must call admin.rpc(\"atomic_wad_deny\")");

  assertStringIncludes(src, "p_governance: wadDenyGovPayload");
  assertStringIncludes(src, 'event_type: "wad.failed"');
  assert(
    !/writeCriticalEventWithPosture\([^)]*\n[^)]*event_type:\s*"wad\.failed"/s.test(src),
    "p3-wad must not double-write wad.failed via TS writer",
  );
});

Deno.test("p3-wad WaD denial fails closed when atomic_wad_deny omits governance_event_id", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(src, "wadDenyResult.governance_event_id");
  assertStringIncludes(src, "WaD denial rolled back");
});

Deno.test("p3-wad governance payloads stamp wad-governance/v1 policy version", async () => {
  const src = await read("p3-wad/index.ts");
  // Both payloads use WAD_POLICY_VERSION via buildPostureSnapshot + metadata.
  assertStringIncludes(src, "wadIssueGovPayload");
  assertStringIncludes(src, "wadDenyGovPayload");
  assertStringIncludes(src, "policy_version: WAD_POLICY_VERSION");
  // The constant resolves to the canonical value.
  const policies = await read("_shared/governance-policy-versions.ts");
  assertStringIncludes(policies, 'WAD_POLICY_VERSION = "wad-governance/v1"');
});

// ── Collapse / finality adoption ─────────────────────────────────────────────

Deno.test("collapse routes through atomic_collapse_record with both governance payloads", async () => {
  const src = await read("collapse/index.ts");
  assertStringIncludes(src, 'adminClient.rpc(\n      "atomic_collapse_record"');
  assertStringIncludes(src, "p_governance_execution: govExecution");
  assertStringIncludes(src, "p_governance_finality: govFinality");
  assertStringIncludes(src, "govExecution");
  assertStringIncludes(src, "govFinality");
});

Deno.test("collapse fails closed when atomic_collapse_record omits governance event IDs", async () => {
  const src = await read("collapse/index.ts");
  assertStringIncludes(src, "collapseResult.execution_event_id");
  assertStringIncludes(src, "collapseResult.finality_event_id");
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "Collapse rolled back");
});

Deno.test("collapse does not TS-write duplicate execution.permitted or finality.recorded on happy path", async () => {
  const src = await read("collapse/index.ts");
  // No writeCriticalEventWithPosture call site with event_type: "execution.permitted"
  // (the import remains for older adoption tests; we assert no actual call).
  assert(
    !/writeCriticalEventWithPosture\(adminClient,\s*\{[^}]*event_type:\s*"execution\.permitted"/s.test(src),
    "collapse must not double-write execution.permitted via TS writer",
  );
  assert(
    !/writeCriticalEventWithPosture\(adminClient,\s*\{[^}]*event_type:\s*"finality\.recorded"/s.test(src),
    "collapse must not double-write finality.recorded via TS writer",
  );
});

Deno.test("collapse governance payloads stamp execution-governance/v1 and finality-governance/v1", async () => {
  const src = await read("collapse/index.ts");
  assertStringIncludes(src, "policy_version: EXECUTION_POLICY_VERSION");
  assertStringIncludes(src, "policy_version: FINALITY_POLICY_VERSION");
  const policies = await read("_shared/governance-policy-versions.ts");
  assertStringIncludes(policies, 'EXECUTION_POLICY_VERSION = "execution-governance/v1"');
  assertStringIncludes(policies, 'FINALITY_POLICY_VERSION = "finality-governance/v1"');
});

// ── Migration: atomic RPC SQL contracts ──────────────────────────────────────

Deno.test("Batch 2 migration defines atomic_wad_issue / atomic_wad_deny / atomic_collapse_record", async () => {
  // Find the most recent Batch-2 migration by searching all migrations.
  const dir = new URL("../../migrations/", import.meta.url);
  const files: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".sql")) files.push(e.name);
  }
  let found = false;
  for (const f of files.sort().reverse()) {
    const sql = await Deno.readTextFile(new URL(f, dir));
    if (
      sql.includes("CREATE OR REPLACE FUNCTION public.atomic_wad_issue") &&
      sql.includes("CREATE OR REPLACE FUNCTION public.atomic_wad_deny") &&
      sql.includes("CREATE OR REPLACE FUNCTION public.atomic_collapse_record")
    ) {
      // All three call gov_emit_event in-transaction.
      assertStringIncludes(sql, "public.gov_emit_event(v_gov_input)");
      assertStringIncludes(sql, "public.gov_emit_event(v_exec_input)");
      assertStringIncludes(sql, "public.gov_emit_event(v_final_input)");
      // All three are SECURITY DEFINER and locked to service_role.
      assertStringIncludes(sql, "GRANT  EXECUTE ON FUNCTION public.atomic_wad_issue");
      assertStringIncludes(sql, "GRANT  EXECUTE ON FUNCTION public.atomic_wad_deny");
      assertStringIncludes(sql, "GRANT  EXECUTE ON FUNCTION public.atomic_collapse_record");
      assertStringIncludes(sql, "TO service_role");
      found = true;
      break;
    }
  }
  assert(found, "Batch 2 migration with all three atomic RPCs must exist");
});
