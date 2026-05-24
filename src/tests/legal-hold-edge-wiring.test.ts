/**
 * DATA-003 Phase 1 — Edge-function legal-hold WIRING tests.
 *
 * These tests read the deployed edge function source files and prove,
 * statically, that each wired callsite:
 *   1. imports `assertNoLegalHold` from the shared helper
 *   2. invokes the check BEFORE the destructive / anonymising operation
 *   3. on `blocked === true`, short-circuits (skip / 409 / return) and
 *      does NOT execute the destructive operation
 *   4. uses the canonical record_group sentinel for batch jobs, or
 *      per-entity scopes for per-record / per-user callsites
 *
 * Static wiring proof is the project's documented equivalent of Deno
 * integration tests for callsite presence (see
 * `d4c-3a-cancelled-email-change-wiring.test.ts` for the same pattern).
 *
 * Behavioural proof — that `blocked=true` blocks, `blocked=false`
 * allows, and `released` does not block — is in
 * `legal-hold-helper.test.ts` and `legal-hold-edge-behaviour.test.ts`
 * (the helper is the single chokepoint, so the helper-level behavioural
 * suite is what proves the live blocking semantics for all callsites).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SHARED_HELPER_IMPORT = /from\s+["']\.\.\/_shared\/legal-hold\.ts["']/;
const ASSERT_CALL = /assertNoLegalHold\s*\(/;

const PATHS = {
  delete_account: "supabase/functions/delete-account/index.ts",
  user_export_request: "supabase/functions/user-export-request/index.ts",
  data_retention: "supabase/functions/data-retention/index.ts",
  storage_retention_cleanup: "supabase/functions/storage-retention-cleanup/index.ts",
  storage_orphan_cleanup: "supabase/functions/storage-orphan-cleanup/index.ts",
  cold_storage_archive: "supabase/functions/cold-storage-archive/index.ts",
  email_log_anonymise: "supabase/functions/email-log-anonymise/index.ts",
  document_revoke: "supabase/functions/document-revoke/index.ts",
} as const;

/**
 * Find the byte-offset of the first call to assertNoLegalHold in `src`
 * and the byte-offset of `needle` and assert the assertion comes first.
 */
function assertCallBefore(src: string, needle: string | RegExp, label: string) {
  const m = src.match(ASSERT_CALL);
  expect(m, `${label}: assertNoLegalHold not found`).toBeTruthy();
  const callIdx = src.indexOf(m![0]);
  const targetIdx =
    typeof needle === "string"
      ? src.indexOf(needle)
      : (src.match(needle)?.index ?? -1);
  expect(
    targetIdx,
    `${label}: target not found (${needle.toString()})`,
  ).toBeGreaterThan(-1);
  expect(
    callIdx,
    `${label}: assertNoLegalHold must appear before ${needle}`,
  ).toBeLessThan(targetIdx);
}

describe("DATA-003 — every wired callsite imports the shared helper", () => {
  for (const [name, path] of Object.entries(PATHS)) {
    it(`${name}: imports assertNoLegalHold from _shared/legal-hold.ts`, () => {
      const src = read(path);
      expect(src, `${path} missing legal-hold import`).toMatch(SHARED_HELPER_IMPORT);
      expect(src, `${path} missing assertNoLegalHold call`).toMatch(ASSERT_CALL);
    });
  }
});

describe("DATA-003 — delete-account (user/org scope, 409 legal_hold_active)", () => {
  const src = read(PATHS.delete_account);

  it("scopes the check to user + org of the caller", () => {
    expect(src).toMatch(/scope_type:\s*"user"\s*,\s*scope_id:\s*user\.id/);
    expect(src).toMatch(/scope_type:\s*"org"\s+as\s+const\s*,\s*scope_id:\s*profile\.org_id/);
  });

  it("returns 409 legal_hold_active when blocked", () => {
    expect(src).toMatch(/holdCheck\.blocked/);
    expect(src).toMatch(/error:\s*"legal_hold_active"/);
    expect(src).toMatch(/409/);
  });

  it("blocks BEFORE profile anonymisation / role revoke / scrub", () => {
    assertCallBefore(src, ".from(\"profiles\")", "delete-account.profile_anonymise");
    assertCallBefore(src, ".from(\"user_roles\").delete()", "delete-account.role_revoke");
    assertCallBefore(src, "scrub_user_pii", "delete-account.scrub");
  });
});

describe("DATA-003 — user-export-request (user/org scope, no payload, no URL)", () => {
  const src = read(PATHS.user_export_request);

  it("delegates through checkLegalHold wrapper using assertNoLegalHold", () => {
    expect(src).toMatch(/async function checkLegalHold/);
    expect(src).toMatch(/assertNoLegalHold\(\s*admin\s*,\s*scopes/);
    expect(src).toMatch(/scope_type:\s*"user"\s*,\s*scope_id:\s*userId/);
    expect(src).toMatch(/scope_type:\s*"org"\s+as\s+const\s*,\s*scope_id:\s*o/);
  });

  it("classifies blocked status as legal_or_security_hold_active / legal_hold_check_failed", () => {
    expect(src).toMatch(/legal_or_security_hold_active/);
    expect(src).toMatch(/legal_hold_check_failed/);
  });

  it("the previous fail-OPEN stub is gone (no swallow-as-no-hold)", () => {
    // Old stub used `.maybeSingle()` directly on legal_holds and returned
    // {blocked:false} on error. Helper is now the only path.
    expect(src).not.toMatch(/from\(["']legal_holds["']\)[\s\S]{0,200}maybeSingle/);
  });
});

describe("DATA-003 — data-retention (batch sentinel + per-row scope)", () => {
  const src = read(PATHS.data_retention);

  it("uses RECORD_GROUP_IDS.retention_enforcement as batch sentinel", () => {
    expect(src).toMatch(/RECORD_GROUP_IDS\.retention_enforcement/);
    expect(src).toMatch(/scope_type:\s*"record_group"/);
  });

  it("performs per-record check using TABLE_TO_SCOPE mapping", () => {
    expect(src).toMatch(/TABLE_TO_SCOPE\[flag\.table_name\]/);
    expect(src).toMatch(/scope_id:\s*flag\.record_id/);
  });

  it("blocked batch short-circuits the table loop (continue)", () => {
    expect(src).toMatch(/batchHold\.blocked[\s\S]{0,200}continue/);
  });

  it("blocked per-record skips retention_flags mutation", () => {
    // The retention_flags UPDATE must come AFTER the per-row hold check
    // and after the `if (rowHold.blocked) { ...; continue; }` branch.
    const rowHoldIdx = src.indexOf("rowHold.blocked");
    const updateIdx = src.indexOf(".from(\"retention_flags\")\n            .update(");
    expect(rowHoldIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeGreaterThan(rowHoldIdx);
  });
});

describe("DATA-003 — storage-retention-cleanup (batch + per-file evidence scope)", () => {
  const src = read(PATHS.storage_retention_cleanup);

  it("uses RECORD_GROUP_IDS.storage_deletion_queue as batch sentinel", () => {
    expect(src).toMatch(/RECORD_GROUP_IDS\.storage_deletion_queue/);
  });

  it("blocked batch returns skipped_legal_hold === pendingItems.length and skips loop", () => {
    expect(src).toMatch(/skipped_legal_hold:\s*pendingItems\.length/);
    expect(src).toMatch(/Blocked by active legal hold/);
  });

  it("per-file check uses evidence scope keyed on queue row id", () => {
    expect(src).toMatch(/scope_type:\s*"evidence"\s*,\s*scope_id:\s*item\.id/);
  });

  it("storage.remove is NEVER reached when fileHold.blocked", () => {
    // Order: per-item assertNoLegalHold → if blocked continue → storage.from().remove()
    const blockedIdx = src.indexOf("fileHold.blocked");
    const removeIdx = src.indexOf(".storage\n        .from(item.bucket_id)\n        .remove(");
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(removeIdx).toBeGreaterThan(blockedIdx);
    // and skippedLegalHold++ + continue must sit between
    const slice = src.slice(blockedIdx, removeIdx);
    expect(slice).toMatch(/skippedLegalHold\+\+/);
    expect(slice).toMatch(/continue/);
  });

  it("summary surfaces skipped_legal_hold counter", () => {
    expect(src).toMatch(/skipped_legal_hold:\s*skippedLegalHold/);
  });
});

describe("DATA-003 — storage-orphan-cleanup (batch sentinel short-circuit)", () => {
  const src = read(PATHS.storage_orphan_cleanup);

  it("uses RECORD_GROUP_IDS.storage_orphan_cleanup as batch sentinel", () => {
    expect(src).toMatch(/RECORD_GROUP_IDS\.storage_orphan_cleanup/);
  });

  it("returns skipped_legal_hold:true BEFORE bucket recursion and storage.remove", () => {
    const blockedIdx = src.indexOf("batchHold.blocked");
    const bucketLoopIdx = src.indexOf("for (const cfg of BUCKETS)");
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(bucketLoopIdx).toBeGreaterThan(blockedIdx);
    // and the return inside `if (batchHold.blocked)` must include the skipped flag
    expect(src).toMatch(/batchHold\.blocked[\s\S]{0,300}skipped_legal_hold:\s*true/);
  });
});

describe("DATA-003 — cold-storage-archive (batch sentinel + per-flag scope)", () => {
  const src = read(PATHS.cold_storage_archive);

  it("uses RECORD_GROUP_IDS.cold_storage_archive as batch sentinel", () => {
    expect(src).toMatch(/RECORD_GROUP_IDS\.cold_storage_archive/);
  });

  it("blocked batch returns skipped_legal_hold === pendingFlags.length", () => {
    expect(src).toMatch(/skipped_legal_hold:\s*pendingFlags\.length/);
  });

  it("per-row check uses COLD_TABLE_TO_SCOPE mapping with flag.record_id", () => {
    expect(src).toMatch(/COLD_TABLE_TO_SCOPE\[flag\.table_name\]/);
    expect(src).toMatch(/scope_id:\s*flag\.record_id/);
  });

  it("when rowHold.blocked, skip fetch/upload/retention_flags update", () => {
    const blockedIdx = src.indexOf("rowHold.blocked");
    const fetchIdx = src.indexOf("// 1. Fetch the source record");
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(blockedIdx);
    const slice = src.slice(blockedIdx, fetchIdx);
    expect(slice).toMatch(/skippedLegalHold\+\+/);
    expect(slice).toMatch(/continue/);
  });
});

describe("DATA-003 — email-log-anonymise (batch sentinel before RPC)", () => {
  const src = read(PATHS.email_log_anonymise);

  it("uses RECORD_GROUP_IDS.email_send_log_anonymise sentinel", () => {
    expect(src).toMatch(/RECORD_GROUP_IDS\.email_send_log_anonymise/);
  });

  it("anonymise_old_email_send_log RPC is NOT called when blocked", () => {
    const blockedIdx = src.indexOf("hold.blocked");
    const rpcIdx = src.indexOf('rpc("anonymise_old_email_send_log"');
    expect(blockedIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(blockedIdx);
    // The blocked branch must return BEFORE reaching the RPC call.
    const slice = src.slice(blockedIdx, rpcIdx);
    expect(slice).toMatch(/return\s+json\(/);
    expect(slice).toMatch(/skipped_legal_hold:\s*true/);
  });
});

describe("DATA-003 — document-revoke (evidence + match scope, 409 LEGAL_HOLD_ACTIVE)", () => {
  const src = read(PATHS.document_revoke);

  it("scopes the check to evidence + match of the document", () => {
    expect(src).toMatch(/scope_type:\s*"evidence"\s*,\s*scope_id:\s*documentId/);
    expect(src).toMatch(/scope_type:\s*"match"\s*,\s*scope_id:\s*document\.match_id/);
  });

  it("throws ApiException LEGAL_HOLD_ACTIVE 409 when blocked", () => {
    expect(src).toMatch(/docHold\.blocked/);
    expect(src).toMatch(/ApiException\(\s*\n?\s*"LEGAL_HOLD_ACTIVE"/);
    expect(src).toMatch(/409/);
  });

  it("blocks BEFORE match_documents update and document_access revoke", () => {
    assertCallBefore(src, ".from(\"match_documents\")\n        .update(", "document-revoke.update");
    assertCallBefore(src, ".from(\"document_access\")\n        .update(", "document-revoke.revoke_access");
  });
});
