/**
 * Governance Record Atomicity — Batch 1 tests.
 *
 * Scope: POI issuance/transition + credit burn.
 *
 * These are static adoption/contract tests that prove:
 *   • token-metering wires p_governance into atomic_token_burn
 *   • token-metering no longer calls writeCriticalEventWithPosture for
 *     "credit.burned" on the happy path (event_store insert now lives
 *     inside the SECURITY DEFINER SQL transaction)
 *   • pois/index.ts + poi-transition/index.ts route POI mutations
 *     through atomic RPCs (atomic_pois_create, atomic_pois_transition,
 *     atomic_poi_match_transition, atomic_generate_poi_v2 + p_governance)
 *   • the SQL helpers (gov_emit_event, gov_redact_jsonb, gov_domain_for,
 *     atomic_token_burn(...,p_governance), atomic_generate_poi_v2(...,p_governance),
 *     atomic_poi_match_transition, atomic_pois_transition, atomic_pois_create)
 *     exist in the Batch 1 migration with the expected shapes.
 *
 * True transactional rollback (i.e. forcing gov_emit_event to throw mid-RPC
 * and observing that the credit/POI mutation also rolls back) requires a
 * live database and is NOT exercised here. See "Atomicity proof" in the
 * Batch 1 completion report for what still needs live DB integration.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

const MIGRATION = "../migrations/20260525063357_b9cf4ce4-7180-45f2-8c61-a0450fab7045.sql";

// ─────────────────────────────────────────────────────────────────────────────
// SQL helper / RPC contract
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("Batch 1 migration defines all required SQL helpers", async () => {
  const sql = await read(MIGRATION);
  for (const sym of [
    "FUNCTION public.gov_redact_jsonb",
    "FUNCTION public.gov_domain_for",
    "FUNCTION public.gov_emit_event",
    "FUNCTION public.atomic_token_burn",
    "FUNCTION public.atomic_generate_poi_v2",
    "FUNCTION public.atomic_poi_match_transition",
    "FUNCTION public.atomic_pois_transition",
    "FUNCTION public.atomic_pois_create",
  ]) {
    assertStringIncludes(sql, sym);
  }
});

Deno.test("gov_emit_event enforces validation + hash chain + 5-min idempotency", async () => {
  const sql = await read(MIGRATION);
  // Validation gates
  assertStringIncludes(sql, "GOV_AUDIT_INVALID: event_type required");
  assertStringIncludes(sql, "GOV_AUDIT_INVALID: org_id required");
  assertStringIncludes(sql, "GOV_AUDIT_INVALID: aggregate_type required");
  assertStringIncludes(sql, "GOV_AUDIT_INVALID: aggregate_id required");
  assertStringIncludes(sql, "GOV_AUDIT_INVALID: source_function required");
  assertStringIncludes(sql, "GOV_AUDIT_POSTURE_REQUIRED");
  assertStringIncludes(sql, "GOV_AUDIT_POSTURE_INVALID");
  // Critical-event redaction
  assertStringIncludes(sql, "public.gov_redact_jsonb(COALESCE(p_input->'metadata'");
  // 5-minute idempotency window scoped on (aggregate_id, event_type, idempotency_key)
  assertStringIncludes(sql, "interval '5 minutes'");
  assertStringIncludes(sql, "payload->>'idempotency_key' = v_idempotency");
  // Hash chain (prev_hash → SHA-256 of canonical text)
  assertStringIncludes(sql, "extensions.digest(v_canonical_text::bytea, 'sha256')");
  assertStringIncludes(sql, "prev_hash");
});

Deno.test("atomic_token_burn accepts p_governance and emits event in-transaction", async () => {
  const sql = await read(MIGRATION);
  // Signature includes p_governance jsonb DEFAULT NULL
  assertStringIncludes(
    sql,
    "p_governance jsonb DEFAULT NULL",
  );
  // The credit_burn branch defaults to credit.burned and calls gov_emit_event
  assertStringIncludes(sql, "COALESCE(p_governance->>'event_type','credit.burned')");
  assertStringIncludes(sql, "v_governance_event_id := public.gov_emit_event(v_gov_input)");
  // Returned jsonb exposes governance_event_id so the caller can fail-closed
  assertStringIncludes(sql, "'governance_event_id', v_governance_event_id");
  // Locked down to service_role
  assertStringIncludes(
    sql,
    "GRANT  EXECUTE ON FUNCTION public.atomic_token_burn(uuid, integer, text, text, jsonb) TO service_role",
  );
});

Deno.test("atomic_generate_poi_v2 accepts p_governance and returns governance_event_id", async () => {
  const sql = await read(MIGRATION);
  assertStringIncludes(sql, "COALESCE(p_governance->>'event_type','poi.created')");
  // Returned object surfaces governance_event_id
  const re = /'governance_event_id',\s*v_governance_event_id/g;
  assert((sql.match(re) ?? []).length >= 2, "expected multiple RPCs to return governance_event_id");
});

// ─────────────────────────────────────────────────────────────────────────────
// token-metering adoption
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("token-metering passes p_governance into atomic_token_burn", async () => {
  const src = await read("_shared/token-metering.ts");
  // RPC call now supplies p_governance
  assertStringIncludes(src, 'supabase.rpc("atomic_token_burn"');
  assertStringIncludes(src, "p_governance: governancePayload");
  // The governance payload carries the canonical credit.burned shape
  assertStringIncludes(src, 'event_type: "credit.burned"');
  assertStringIncludes(src, 'aggregate_type: "credit_burn"');
  assertStringIncludes(src, "policy_version: CREDIT_POLICY_VERSION");
  assertStringIncludes(src, 'allowed_or_blocked: "allowed"');
  // Idempotency key derived from requestId so duplicate retries within 5 min collapse
  assertStringIncludes(src, "idempotency_key: idempotencyKey");
  assertStringIncludes(src, "credit.burned:${orgId}:${requestId}");
});

Deno.test("token-metering no longer TS-writes credit.burned on the happy burn path", async () => {
  const src = await read("_shared/token-metering.ts");
  // Scope strictly to the burnTokens function body.
  const startIdx = src.indexOf("export async function burnTokens");
  assert(startIdx >= 0, "burnTokens export not found");
  // Use the next "export " (function/const) as the end of the body.
  const tail = src.slice(startIdx + 1);
  const nextExportRel = tail.indexOf("\nexport ");
  const endIdx = nextExportRel >= 0 ? startIdx + 1 + nextExportRel : src.length;
  const burnTokensBody = src.slice(startIdx, endIdx);
  const afterRpc = burnTokensBody.slice(burnTokensBody.indexOf('rpc("atomic_token_burn"'));
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"credit\.burned"/s.test(afterRpc),
    "burnTokens must not TS-write credit.burned after atomic_token_burn (would duplicate event_store row)",
  );
  // And it must fail-closed if the RPC returned success without a governance_event_id.
  assertStringIncludes(src, "atomic_token_burn returned success without governance_event_id");
  assertStringIncludes(src, '"GOV_AUDIT_WRITE_FAILED"');
});

Deno.test("token-metering preserves blocked/error best-effort audit paths", async () => {
  const src = await read("_shared/token-metering.ts");
  // The two failure-path best-effort audits must still fire so blocked/errored
  // burns remain visible in event_store even when the RPC rolls back.
  assertStringIncludes(src, 'event_type: "credit.burn_attempted"');
  assertStringIncludes(src, 'event_type: "credit.burn_blocked"');
  assertStringIncludes(src, "writeGovernanceEventBestEffort");
});

// ─────────────────────────────────────────────────────────────────────────────
// POI adoption
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("pois/index.ts routes create + transition through atomic RPCs", async () => {
  const src = await read("pois/index.ts");
  // Must hit at least one of the new atomic RPCs (no longer pure TS sequencing)
  assert(
    /atomic_pois_create|atomic_pois_transition|atomic_generate_poi_v2/.test(src),
    "pois/index.ts must call atomic_* RPCs for create/transition",
  );
  // And must pass p_governance so the in-transaction event_store row is emitted
  assertStringIncludes(src, "p_governance");
});

Deno.test("poi-transition uses atomic_poi_match_transition", async () => {
  const src = await read("poi-transition/index.ts");
  assertStringIncludes(src, "atomic_poi_match_transition");
  assertStringIncludes(src, "p_governance");
});

Deno.test("POI Batch 1 happy path does not double-write via TS writer", async () => {
  // After an atomic RPC returns governance_event_id, the edge function must
  // NOT also call writeCriticalEventWithPosture for the same event_type, or
  // we'd duplicate the event_store row (the 5-min idempotency window in
  // gov_emit_event collapses identical idempotency_key writes, but the TS
  // writer uses its own keying, so we enforce the rule statically).
  for (const f of ["pois/index.ts", "poi-transition/index.ts"]) {
    const src = await read(f);
    const hasAtomicRpc = /atomic_(pois_create|pois_transition|poi_match_transition|generate_poi_v2)/
      .test(src);
    if (!hasAtomicRpc) continue;
    // Allow TS writer for non-Batch-1 events, but not for poi.created /
    // poi.state_changed on the success branch right after the RPC.
    const offenders = src.match(
      /governance_event_id[\s\S]{0,400}?writeCriticalEventWithPosture\([\s\S]{0,200}?event_type:\s*"poi\.(created|state_changed)"/g,
    );
    assertEquals(offenders, null, `${f}: TS writer fires for POI event right after atomic RPC`);
  }
});
