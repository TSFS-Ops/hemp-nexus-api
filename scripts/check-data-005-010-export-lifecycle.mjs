#!/usr/bin/env node
/**
 * DATA-005 / DATA-010 Phase 2A — Export lifecycle prebuild guard.
 *
 * Pins:
 *   1. 13 canonical audit names (7 user + 6 admin) in both SSOTs.
 *   2. State enums match between client and Deno mirrors.
 *   3. Phase 2A export-destroy is dry-run only (no storage.remove() call,
 *      no destructive flag honoured, never emits final destruction audit).
 *   4. Private bucket names appear in the migration set.
 *   5. export-prepare contains an allow-list projection and never uses
 *      `SELECT *` on user/admin data tables.
 *   6. Self-approval guard is wired in admin-export-approve.
 *   7. AAL2 assertion is wired in admin-export-* and the admin branch of
 *      export-download.
 *   8. Legacy Phase 1 audit names remain present in user-export-request.
 */
import { readFileSync, existsSync } from "node:fs";

const failures = [];
const fail = (m) => failures.push(m);

function read(p) {
  if (!existsSync(p)) { fail(`Missing required file: ${p}`); return ""; }
  return readFileSync(p, "utf8");
}

const CANONICAL = [
  "data.export_request_received",
  "data.export_requester_verified",
  "data.export_prepared",
  "data.export_delivered",
  "data.export_blocked_verification_failed",
  "data.export_limited_retention_or_confidentiality_required",
  "data.export_file_destroyed",
  "data.admin_export_requested",
  "data.admin_export_approved",
  "data.admin_export_generated",
  "data.admin_export_downloaded",
  "data.admin_export_blocked_or_declined",
  "data.admin_export_file_destroyed",
];

const clientSsot = read("src/lib/data/export-lifecycle-audit.ts");
const denoSsot = read("supabase/functions/_shared/export-lifecycle-audit.ts");
for (const n of CANONICAL) {
  if (!clientSsot.includes(`"${n}"`)) fail(`Client SSOT missing canonical: ${n}`);
  if (!denoSsot.includes(`"${n}"`)) fail(`Deno SSOT missing canonical: ${n}`);
}

// State machine parity
const clientStates = read("src/lib/data/export-state-machine.ts");
const denoStates = read("supabase/functions/_shared/export-state-machine.ts");
const STATE_TOKENS = [
  "verification_required", "export_preparation_required", "ready_for_delivery",
  "delivered", "blocked_verification_failed",
  "limited_retention_or_confidentiality_required",
  "awaiting_approval", "ready_for_download", "downloaded", "blocked_or_declined",
];
for (const s of STATE_TOKENS) {
  if (!clientStates.includes(`"${s}"`)) fail(`Client state SSOT missing: ${s}`);
  if (!denoStates.includes(`"${s}"`)) fail(`Deno state SSOT missing: ${s}`);
}

// export-destroy MUST be dry-run only in Phase 2A
const destroy = read("supabase/functions/export-destroy/index.ts");
if (!destroy.includes("phase_2a_dry_run_only")) fail("export-destroy missing phase_2a_dry_run_only marker");
if (!destroy.includes("destructiveEnabled = false")) fail("export-destroy must hard-code destructiveEnabled=false");
if (/\.storage\.from\([^)]+\)\.remove\s*\(/.test(destroy)) fail("export-destroy must NOT call storage .remove() in Phase 2A");
if (destroy.includes("data.export_file_destroyed") || destroy.includes("data.admin_export_file_destroyed")) {
  fail("export-destroy must NOT emit final destruction audit in Phase 2A");
}

// Private bucket names
const REQUIRED_BUCKETS = ["user-exports", "admin-exports"];
const prepare = read("supabase/functions/export-prepare/index.ts");
for (const b of REQUIRED_BUCKETS) {
  if (!destroy.includes(b) && !prepare.includes(b)) {
    // bucket must appear in at least one export fn
    fail(`Bucket ${b} not referenced in export pipeline`);
  }
}

// No SELECT * on user/admin data tables in export-prepare
if (/from\(["'][a-z_]+["']\)\s*\.select\(\s*['"`]\*['"`]/i.test(prepare)) {
  fail("export-prepare must not use SELECT * on data tables");
}
// Must use the allow-list helpers
if (!prepare.includes("safeProjection") || !prepare.includes("USER_EXPORT_CATEGORY_ALLOW_LISTS")) {
  fail("export-prepare must use safeProjection + USER_EXPORT_CATEGORY_ALLOW_LISTS");
}

// Self-approval guard wired
const approve = read("supabase/functions/admin-export-approve/index.ts");
if (!approve.includes("SELF_APPROVAL_BLOCKED") || !approve.includes("approver.id === reqRow.requester_user_id")) {
  fail("admin-export-approve missing self-approval server-side guard");
}

// AAL2 wired on admin export surfaces
const adminReq = read("supabase/functions/admin-export-request/index.ts");
const download = read("supabase/functions/export-download/index.ts");
for (const [label, src] of [
  ["admin-export-request", adminReq],
  ["admin-export-approve", approve],
  ["export-download", download],
]) {
  if (!src.includes("assertAal2(")) fail(`${label} missing assertAal2()`);
}

// 5-minute signed URL TTL
if (!download.includes("EXPORT_DOWNLOAD_SIGNED_URL_TTL_SECONDS = 300")) {
  fail("export-download signed URL TTL must be 300 seconds");
}

// Legacy Phase 1 audit names retained in user-export-request
const userReq = read("supabase/functions/user-export-request/index.ts");
for (const legacy of ["data.user_export_requested", "data.user_export_scope_resolved", "data.user_export_blocked_or_declined"]) {
  if (!userReq.includes(legacy)) fail(`Legacy Phase 1 audit removed from user-export-request: ${legacy}`);
}

if (failures.length) {
  console.error("\n❌ DATA-005/010 Phase 2A export-lifecycle guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `✓ DATA-005/010 Phase 2A: ${CANONICAL.length} canonical audit(s), ${STATE_TOKENS.length} state(s), dry-run destroy, private buckets, allow-list projection, self-approval guard, AAL2, 300s signed URL TTL all intact.`,
);
