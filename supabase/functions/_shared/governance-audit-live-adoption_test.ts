/**
 * Phase 2 live-flow adoption tests — updated for Atomicity Batch 1+2.
 *
 * After Batch 1+2, the critical canonical events for POI, WaD pass/fail,
 * primary credit burn (burnTokens), and credit burn for action
 * (burnTokensForAction) are emitted inside SECURITY DEFINER RPCs:
 *   - atomic_pois_create / atomic_pois_transition / atomic_poi_match_transition
 *   - atomic_wad_issue / atomic_wad_deny
 *   - atomic_token_burn (with p_governance)
 *
 * These tests assert the production edge-function source code now routes
 * through the atomic RPCs with p_governance, fails closed on missing
 * governance_event_id, and does not double-write via the TS critical
 * writer on the happy path.
 *
 * Run with: deno test supabase/functions/_shared/governance-audit-live-adoption_test.ts
 */

import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

// ── POI flows ────────────────────────────────────────────────────────────────

Deno.test("poi-transition live flow: atomic_poi_match_transition with p_governance (fail-closed)", async () => {
  const src = await read("poi-transition/index.ts");
  assertStringIncludes(src, 'atomic_poi_match_transition');
  assertStringIncludes(src, 'p_governance');
  // event_type literal still present in the governance payload built in TS.
  assertStringIncludes(src, '"poi.state_changed"');
  assertStringIncludes(src, 'source_function: "poi-transition"');
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
});

Deno.test("pois live flow: atomic_pois_create + atomic_pois_transition with p_governance", async () => {
  const src = await read("pois/index.ts");
  assertStringIncludes(src, 'atomic_pois_create');
  assertStringIncludes(src, 'atomic_pois_transition');
  assertStringIncludes(src, '"poi.created"');
  assertStringIncludes(src, '"poi.state_changed"');
  // p_governance must appear for both create and transition paths.
  const govCalls = src.match(/p_governance:/g) ?? [];
  assert(
    govCalls.length >= 3,
    `pois/index.ts expected ≥3 p_governance call sites (bilateral create + unilateral create + transition), got ${govCalls.length}`,
  );
});

// ── WaD flows ────────────────────────────────────────────────────────────────

Deno.test("p3-wad live flow: atomic_wad_issue + atomic_wad_deny with p_governance (fail-closed)", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(src, 'atomic_wad_issue');
  assertStringIncludes(src, 'atomic_wad_deny');
  // Canonical event types appear inside governance payloads (idempotency_key).
  assertStringIncludes(src, 'wad.passed');
  assertStringIncludes(src, 'wad.failed');
  assertStringIncludes(src, 'source_function: "p3-wad"');
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
  assertStringIncludes(src, "WaD issue rolled back");
  assertStringIncludes(src, "WaD denial rolled back");
});

Deno.test("p3-wad live flow: emits wad.manual_review_required on UBO incomplete", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(
    src,
    '"wad.manual_review_required"',
    "p3-wad must emit wad.manual_review_required when UBO_COMPLETENESS gate is incomplete",
  );
  // Manual-review event runs alongside the fail-closed atomic wad.failed.
  assertStringIncludes(
    src,
    "writeGovernanceEventBestEffort",
    "wad.manual_review_required should be a best-effort write (observability alongside fail-closed atomic wad.failed)",
  );
});

Deno.test("p3-wad live flow: emits wad.check_failed on discovery gate block", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(
    src,
    '"wad.check_failed"',
    "p3-wad must emit wad.check_failed when DISCOVERY_ELIGIBILITY blocks",
  );
});

// ── Credit burn flows ────────────────────────────────────────────────────────

Deno.test("token-metering live flow: atomic_token_burn with p_governance for BOTH burnTokens and burnTokensForAction", async () => {
  const src = await read("_shared/token-metering.ts");
  // Both burn helpers must call the atomic RPC with p_governance.
  const rpcCalls = src.match(/rpc\("atomic_token_burn"/g) ?? [];
  assert(
    rpcCalls.length >= 2,
    `token-metering expected ≥2 atomic_token_burn call sites, got ${rpcCalls.length}`,
  );
  const govCalls = src.match(/p_governance:\s*\w+/g) ?? [];
  assert(
    govCalls.length >= 2,
    `token-metering expected ≥2 p_governance args (burnTokens + burnTokensForAction), got ${govCalls.length}`,
  );
  // event_type literal in both governance payloads.
  const burnedLits = src.match(/event_type:\s*"credit\.burned"/g) ?? [];
  assert(
    burnedLits.length >= 2,
    `token-metering expected ≥2 event_type "credit.burned" literals in governance payloads, got ${burnedLits.length}`,
  );
  // Fail-closed governance_event_id check in both helpers.
  const idChecks = src.match(/!burnResult\.governance_event_id/g) ?? [];
  assert(
    idChecks.length >= 2,
    `token-metering expected ≥2 governance_event_id fail-closed guards, got ${idChecks.length}`,
  );
  // source_function literals for both helpers.
  assertStringIncludes(src, 'source_function: "burnTokens"');
  assertStringIncludes(src, 'source_function: "burnTokensForAction"');
  // Duplicate-write guard: no TS-side critical writer for credit.burned on
  // either happy path (best-effort burn_attempted / burn_blocked are allowed).
  assert(
    !/writeCriticalEventWithPosture\([^)]*event_type:\s*"credit\.burned"/s.test(src),
    "token-metering must not double-write credit.burned via TS critical writer",
  );
  assertStringIncludes(src, "GOV_AUDIT_WRITE_FAILED");
});

Deno.test("token-metering live flow: emits credit.burn_blocked and credit.burn_attempted (best-effort)", async () => {
  const src = await read("_shared/token-metering.ts");
  assertStringIncludes(src, '"credit.burn_blocked"');
  assertStringIncludes(src, '"credit.burn_attempted"');
  assertStringIncludes(
    src,
    "writeGovernanceEventBestEffort",
    "burn-blocked / burn-attempted are best-effort (observability around an already-failed/blocked burn)",
  );
});

// ── Posture + idempotency hygiene across all wired flows ─────────────────────

Deno.test("all wired flows include buildPostureSnapshot at every critical write", async () => {
  const files = [
    "poi-transition/index.ts",
    "pois/index.ts",
    "p3-wad/index.ts",
    "collapse/index.ts",
    "_shared/token-metering.ts",
  ];
  for (const f of files) {
    const src = await read(f);
    assert(
      /posture(_snapshot)?:\s*buildPostureSnapshot\(/.test(src),
      `[${f}] every critical write must include a buildPostureSnapshot() posture`,
    );
  }
});
