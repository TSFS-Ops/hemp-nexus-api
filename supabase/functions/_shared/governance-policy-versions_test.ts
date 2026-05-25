/**
 * Phase 2 — policy-version stamping coverage tests for already-wired
 * canonical governance events. Static grep-based, mirrors the existing
 * gap-closure adoption test style.
 */
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ADMIN_HQ_DECISION_POLICY_VERSION,
  CREDIT_POLICY_VERSION,
  DISPUTE_POLICY_VERSION,
  EXECUTION_POLICY_VERSION,
  FINALITY_POLICY_VERSION,
  LEGAL_HOLD_POLICY_VERSION,
  PAYMENT_POLICY_VERSION,
  POI_POLICY_VERSION,
  POLICY_VERSION_BY_EVENT_TYPE,
  WAD_POLICY_VERSION,
} from "./governance-policy-versions.ts";

const ROOT = new URL("../", import.meta.url);
const read = (rel: string) => Deno.readTextFile(new URL(rel, ROOT));

Deno.test("policy-version constants are stable strings ending in /vN", () => {
  for (const v of [
    POI_POLICY_VERSION, WAD_POLICY_VERSION, EXECUTION_POLICY_VERSION,
    FINALITY_POLICY_VERSION, CREDIT_POLICY_VERSION, PAYMENT_POLICY_VERSION,
    DISPUTE_POLICY_VERSION, ADMIN_HQ_DECISION_POLICY_VERSION, LEGAL_HOLD_POLICY_VERSION,
  ]) {
    assert(/^[a-z-]+\/v\d+$/.test(v), `bad policy-version format: ${v}`);
  }
});

Deno.test("POLICY_VERSION_BY_EVENT_TYPE covers every wired canonical event family", () => {
  const expected = [
    "poi.created", "poi.state_changed",
    "wad.passed", "wad.failed", "wad.manual_review_required", "wad.check_failed",
    "credit.burned", "credit.burn_attempted", "credit.burn_blocked",
    "execution.permitted", "finality.recorded",
    "dispute.opened", "dispute.closed", "dispute.released",
    "payment.event_created",
    "legal_hold.applied", "legal_hold.released",
    "admin.hq_decision_recorded",
  ];
  for (const e of expected) {
    assert(POLICY_VERSION_BY_EVENT_TYPE[e], `missing mapping for ${e}`);
  }
});

const POI_FILES = ["pois/index.ts", "poi-transition/index.ts"];
for (const f of POI_FILES) {
  Deno.test(`${f} stamps POI_POLICY_VERSION on wired POI events`, async () => {
    const src = await read(f);
    assertStringIncludes(src, "POI_POLICY_VERSION");
    assertStringIncludes(src, "governance-policy-versions");
    // Every wired POI write should reference the constant.
    const writes = (src.match(/event_type:\s*"poi\.(created|state_changed)"/g) ?? []).length;
    const stamps = (src.match(/policy_version:\s*POI_POLICY_VERSION/g) ?? []).length;
    assert(stamps >= writes, `${f}: ${stamps} stamps < ${writes} POI writes`);
  });
}

Deno.test("p3-wad stamps WAD_POLICY_VERSION on all wired WaD events", async () => {
  const src = await read("p3-wad/index.ts");
  assertStringIncludes(src, "WAD_POLICY_VERSION");
  const writes = (src.match(/event_type:\s*"wad\.(passed|failed|manual_review_required|check_failed)"/g) ?? []).length;
  const stamps = (src.match(/policy_version:\s*WAD_POLICY_VERSION/g) ?? []).length;
  assertEquals(writes, 4, "expected 4 wad.* canonical writes");
  assert(stamps >= writes, `expected ≥${writes} WAD stamps, got ${stamps}`);
});

Deno.test("collapse stamps EXECUTION + FINALITY policy versions", async () => {
  const src = await read("collapse/index.ts");
  assertStringIncludes(src, "policy_version: EXECUTION_POLICY_VERSION");
  assertStringIncludes(src, "policy_version: FINALITY_POLICY_VERSION");
});

Deno.test("token-metering stamps CREDIT_POLICY_VERSION on every credit.* event", async () => {
  const src = await read("_shared/token-metering.ts");
  assertStringIncludes(src, "CREDIT_POLICY_VERSION");
  const writes = (src.match(/event_type:\s*"credit\.(burned|burn_attempted|burn_blocked)"/g) ?? []).length;
  const stamps = (src.match(/policy_version:\s*CREDIT_POLICY_VERSION/g) ?? []).length;
  assertEquals(writes, 6, "expected 6 credit.* writes (3 per burn function)");
  assert(stamps >= writes, `expected ≥${writes} CREDIT stamps, got ${stamps}`);
});

Deno.test("token-purchase webhook stamps PAYMENT_POLICY_VERSION on charge.success", async () => {
  const src = await read("token-purchase/index.ts");
  assertStringIncludes(src, "PAYMENT_POLICY_VERSION");
  assertStringIncludes(src, "policy_version: PAYMENT_POLICY_VERSION");
});

Deno.test("payment-governance helper defaults to PAYMENT_POLICY_VERSION when caller omits it", async () => {
  const src = await read("_shared/payment-governance.ts");
  assertStringIncludes(src, "PAYMENT_POLICY_VERSION");
  // Default fallback wired in both posture and metadata.
  const fallbacks = (src.match(/input\.policy_version\s*\?\?\s*PAYMENT_POLICY_VERSION/g) ?? []).length;
  assertEquals(fallbacks, 2);
});

Deno.test("admin-legal-hold stamps LEGAL_HOLD_POLICY_VERSION on apply + release", async () => {
  const src = await read("admin-legal-hold/index.ts");
  assertStringIncludes(src, "LEGAL_HOLD_POLICY_VERSION");
  const stamps = (src.match(/policy_version:\s*LEGAL_HOLD_POLICY_VERSION/g) ?? []).length;
  assert(stamps >= 4, `expected ≥4 legal_hold stamps (posture+metadata × apply/release), got ${stamps}`);
});

Deno.test("match-challenges stamps DISPUTE_POLICY_VERSION on opened/closed/released", async () => {
  const src = await read("match-challenges/index.ts");
  assertStringIncludes(src, "DISPUTE_POLICY_VERSION");
  const stamps = (src.match(/policy_version:\s*DISPUTE_POLICY_VERSION/g) ?? []).length;
  assert(stamps >= 4, `expected ≥4 dispute stamps, got ${stamps}`);
});

Deno.test("admin-hq-audit helper defaults to ADMIN_HQ_DECISION_POLICY_VERSION when caller omits it", async () => {
  const src = await read("_shared/admin-hq-audit.ts");
  assertStringIncludes(src, "ADMIN_HQ_DECISION_POLICY_VERSION");
  const fallbacks = (src.match(/input\.policyVersion\s*\?\?\s*ADMIN_HQ_DECISION_POLICY_VERSION/g) ?? []).length;
  assertEquals(fallbacks, 2, "expected default in both posture and metadata");
});
