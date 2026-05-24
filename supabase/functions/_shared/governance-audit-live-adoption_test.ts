/**
 * Phase 2 live-flow adoption tests.
 *
 * These are not unit tests of the writer — they assert that the production
 * edge-function source code for the three critical flows wired in this turn
 * (POI transitions, WaD pass/fail/manual-review, credit burn) actually
 * imports the canonical governance-audit writer AND calls it with the
 * expected controlled event names. This catches the failure mode where the
 * writer exists but no live flow has adopted it.
 *
 * Run with: deno test supabase/functions/_shared/governance-audit-live-adoption_test.ts
 */

import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";

const ROOT = new URL("../", import.meta.url);

async function read(rel: string): Promise<string> {
  const url = new URL(rel, ROOT);
  return await Deno.readTextFile(url);
}

function assertWires(
  source: string,
  file: string,
  required: {
    eventTypes: string[];
    helpers: string[];
    sourceFunctionLiteral?: string;
  },
) {
  for (const helper of required.helpers) {
    assert(
      source.includes(helper),
      `[${file}] expected to import/call "${helper}" — canonical writer not adopted`,
    );
  }
  for (const evt of required.eventTypes) {
    assertStringIncludes(
      source,
      `"${evt}"`,
      `[${file}] expected event_type "${evt}" to be wired into a writer call`,
    );
  }
  if (required.sourceFunctionLiteral) {
    assertStringIncludes(
      source,
      `source_function: "${required.sourceFunctionLiteral}"`,
      `[${file}] expected source_function literal "${required.sourceFunctionLiteral}"`,
    );
  }
}

// ── POI flows ────────────────────────────────────────────────────────────────

Deno.test("poi-transition live flow: writes poi.state_changed via critical writer", async () => {
  const src = await read("poi-transition/index.ts");
  assertWires(src, "poi-transition/index.ts", {
    helpers: [
      "writeCriticalEventWithPosture",
      "governance-audit-integration",
    ],
    eventTypes: ["poi.state_changed"],
    sourceFunctionLiteral: "poi-transition",
  });
  // fail-closed: must surface GOV_AUDIT_WRITE_FAILED on writer throw
  assertStringIncludes(
    src,
    "GOV_AUDIT_WRITE_FAILED",
    "poi-transition must fail closed when the governance audit write throws",
  );
  // idempotency_extra used so retries dedupe
  assertStringIncludes(
    src,
    "idempotency_extra",
    "poi-transition must derive an idempotency key for the critical event",
  );
});

Deno.test("pois live flow: writes poi.created (bilateral + unilateral) and poi.state_changed", async () => {
  const src = await read("pois/index.ts");
  assertWires(src, "pois/index.ts", {
    helpers: ["writeCriticalEventWithPosture"],
    eventTypes: ["poi.created", "poi.state_changed"],
    sourceFunctionLiteral: "pois",
  });
  // Bilateral + unilateral handlers both call the writer.
  const matches = src.match(/writeCriticalEventWithPosture/g) ?? [];
  assert(
    matches.length >= 3,
    `pois/index.ts expected ≥3 writeCriticalEventWithPosture call sites, got ${matches.length}`,
  );
});

// ── WaD flows ────────────────────────────────────────────────────────────────

Deno.test("p3-wad live flow: writes wad.passed (fail-closed) and wad.failed (fail-closed)", async () => {
  const src = await read("p3-wad/index.ts");
  assertWires(src, "p3-wad/index.ts", {
    helpers: ["writeCriticalEventWithPosture"],
    eventTypes: ["wad.passed", "wad.failed"],
    sourceFunctionLiteral: "p3-wad",
  });
});

Deno.test("p3-wad live flow: emits wad.manual_review_required on UBO incomplete", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(
    src,
    '"wad.manual_review_required"',
    "p3-wad must emit wad.manual_review_required when UBO_COMPLETENESS gate is incomplete",
  );
  // Manual-review event runs alongside the fail-closed wad.failed write.
  assertStringIncludes(
    src,
    "writeGovernanceEventBestEffort",
    "wad.manual_review_required should be a best-effort write (observability alongside fail-closed wad.failed)",
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

Deno.test("token-metering live flow: writes credit.burned (fail-closed) for both burnTokens and burnTokensForAction", async () => {
  const src = await read("_shared/token-metering.ts");
  assertWires(src, "_shared/token-metering.ts", {
    helpers: ["writeCriticalEventWithPosture"],
    eventTypes: ["credit.burned"],
  });
  // Two distinct burn helpers must each call the critical writer.
  const critCalls = src.match(/writeCriticalEventWithPosture/g) ?? [];
  assert(
    critCalls.length >= 2,
    `token-metering expected ≥2 writeCriticalEventWithPosture call sites (burnTokens + burnTokensForAction), got ${critCalls.length}`,
  );
  // Fail-closed contract — caller surfaces GOV_AUDIT_WRITE_FAILED
  assertStringIncludes(
    src,
    "GOV_AUDIT_WRITE_FAILED",
    "token-metering must fail closed when the credit.burned audit write fails",
  );
  // source_function literals for both helpers
  assertStringIncludes(src, 'source_function: "burnTokens"');
  assertStringIncludes(src, 'source_function: "burnTokensForAction"');
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

Deno.test("all wired flows include posture_snapshot or buildPostureSnapshot at every critical call", async () => {
  const files = [
    "poi-transition/index.ts",
    "pois/index.ts",
    "p3-wad/index.ts",
    "_shared/token-metering.ts",
  ];
  for (const f of files) {
    const src = await read(f);
    assert(
      /posture: buildPostureSnapshot\(/.test(src) ||
        /posture_snapshot: buildPostureSnapshot\(/.test(src),
      `[${f}] every critical write must include a buildPostureSnapshot() posture`,
    );
  }
});
