#!/usr/bin/env node
// Batch M static guard — sealed storage file delete awareness.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function fail(m) { console.error(`[batch-m] FAIL: ${m}`); process.exit(1); }
function must(c, m) { if (!c) fail(m); }

// 1. Locate migration
const files = readdirSync("supabase/migrations").sort();
let migPath = null;
for (const f of files) {
  const p = join("supabase/migrations", f);
  const c = readFileSync(p, "utf8");
  if (c.includes("is_storage_object_sealed_match_document") &&
      /Org members can delete own match documents/.test(c) &&
      /is_match_document_sealed/.test(c)) {
    migPath = p; break;
  }
}
if (!migPath) fail("Batch M migration not found");
const sql = readFileSync(migPath, "utf8");

must(/create\s+or\s+replace\s+function\s+public\.is_storage_object_sealed_match_document\s*\(\s*_bucket_id\s+text\s*,\s*_object_name\s+text\s*\)/i.test(sql),
  "helper signature missing");
must(/security\s+definer/i.test(sql), "SECURITY DEFINER missing");
must(/set\s+search_path\s*=\s*public\s*,\s*storage/i.test(sql), "search_path public,storage missing");
must(/'match-documents'/.test(sql), "helper must gate on bucket 'match-documents'");
must(/::uuid/.test(sql), "helper must cast final segment to uuid");
must(/public\.is_match_document_sealed\s*\(/i.test(sql), "helper must delegate to is_match_document_sealed");

// Predicate block should not use hash/match-level shortcuts
const helperBlock = sql.match(/create\s+or\s+replace\s+function\s+public\.is_storage_object_sealed_match_document[\s\S]*?\$\$;/i)?.[0] ?? "";
must(!/sha256/i.test(helperBlock), "helper must not use sha256 inference");
must(!/match_id/i.test(helperBlock), "helper must not use match-level inference");

// DELETE policy rewritten with seal guard
must(/DROP\s+POLICY\s+IF\s+EXISTS\s+"Org members can delete own match documents"\s+ON\s+storage\.objects/i.test(sql),
  "must drop old match-documents DELETE policy");
const createPol = sql.match(/CREATE\s+POLICY\s+"Org members can delete own match documents"[\s\S]*?;/i)?.[0] ?? "";
must(createPol.length > 0, "must recreate match-documents DELETE policy");
must(/FOR\s+DELETE/i.test(createPol), "policy must be FOR DELETE");
must(/bucket_id\s*=\s*'match-documents'/i.test(createPol), "policy must gate on match-documents bucket");
must(/storage\.foldername\(name\)\)\[1\]/i.test(createPol), "policy must retain org-folder check");
must(/has_role\(auth\.uid\(\),\s*'platform_admin'/i.test(createPol), "policy must retain platform_admin check");
must(/AND\s+NOT\s+public\.is_storage_object_sealed_match_document\(bucket_id,\s*name\)/i.test(createPol),
  "policy must add seal guard");

// Must not touch other bucket policies or non-DELETE ops
must(!/kyc-documents/i.test(sql), "must not touch kyc-documents");
must(!/FOR\s+SELECT/i.test(sql), "must not alter SELECT policies");
must(!/FOR\s+INSERT/i.test(sql), "must not alter INSERT policies");
// The migration's only UPDATE-related keyword should be "OR UPDATE" absent
must(!/FOR\s+UPDATE/i.test(sql), "must not alter UPDATE policies");

// 2. Service-role cleanup guard
const fn = readFileSync("supabase/functions/storage-retention-cleanup/index.ts", "utf8");
must(/item\.bucket_id\s*===\s*"match-documents"/.test(fn), "cleanup must special-case match-documents bucket");
must(/is_match_document_sealed/.test(fn), "cleanup must call is_match_document_sealed RPC");
must(/sealed_storage_delete_blocked/.test(fn), "cleanup must emit sealed_storage_delete_blocked marker");
must(/uuidRe/.test(fn) || /\[0-9a-f\]\{8\}-/.test(fn), "cleanup must UUID-validate final segment");
// Must not have removed legal-hold handling
must(/skippedLegalHold/.test(fn), "cleanup must retain legal-hold skip");
must(/assertNoLegalHold/.test(fn), "cleanup must retain legal-hold assertion");

// 3. No provider/email/payment/token/POI/WaD/legal-hold code added
const guardForbidden = [
  /resend/i, /sendgrid/i, /stripe/i, /paystack/i, /payfast/i,
  /token_ledger/i, /poi_events/i, /wads?\b/i,
];
// Only check the newly added guard block (approximation): between marker comments
const guardRegion = fn.split("Batch M:")[1]?.split("try {")[0] ?? "";
// Ensure the guard block itself doesn't reference forbidden systems
for (const re of guardForbidden) {
  if (re.test(guardRegion)) fail(`cleanup guard must not touch: ${re}`);
}

console.log(`[batch-m] OK: ${migPath} + storage-retention-cleanup guard installed`);
