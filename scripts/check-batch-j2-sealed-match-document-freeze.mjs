#!/usr/bin/env node
// Batch J2 static guard — asserts sealed match_document full-freeze migration
// and confirms no out-of-scope changes ship with it.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";
const MARKER = "j2 - sealed match_document full-freeze trigger";

const files = readdirSync(MIG_DIR).sort();
let migPath = null;
for (const f of files) {
  const p = join(MIG_DIR, f);
  const c = readFileSync(p, "utf8").toLowerCase();
  if (c.includes("is_match_document_sealed") && c.includes("assert_match_document_sealed_immutability")) {
    migPath = p;
    break;
  }
}
if (!migPath) fail("Batch J2 migration not found");
const sql = readFileSync(migPath, "utf8");
const lower = sql.toLowerCase();

function must(cond, msg) { if (!cond) fail(msg); }
function fail(msg) { console.error(`[batch-j2] FAIL: ${msg}`); process.exit(1); }

// Helper function
must(/create\s+or\s+replace\s+function\s+public\.is_match_document_sealed\s*\(\s*_doc_id\s+uuid\s*\)/i.test(sql),
  "is_match_document_sealed(_doc_id uuid) missing");
must(/security\s+definer/i.test(sql), "SECURITY DEFINER missing");
must(/set\s+search_path\s*=\s*public/i.test(sql), "SET search_path = public missing");

// Predicate correctness
must(lower.includes("evidence_bundle->'documents'"), "predicate must scan wads.evidence_bundle->'documents'");
must(/doc->>'id'/i.test(sql), "predicate must extract 'id' from bundle document objects");
must(/sealed_at\s+is\s+not\s+null/i.test(sql), "predicate must require sealed_at IS NOT NULL");
must(/revoked_at\s+is\s+null/i.test(sql), "predicate must require revoked_at IS NULL");

// Forbidden shortcuts
const predicateBlock = sql.match(/create\s+or\s+replace\s+function\s+public\.is_match_document_sealed[\s\S]*?\$\$;/i)?.[0] ?? "";
must(!/sha256_hash/i.test(predicateBlock), "predicate must not match on sha256_hash");
must(!/match_id/i.test(predicateBlock), "predicate must not match at match_id level");

// Trigger function + trigger
must(/create\s+or\s+replace\s+function\s+public\.assert_match_document_sealed_immutability\s*\(\s*\)/i.test(sql),
  "assert_match_document_sealed_immutability() missing");
must(/sealed_match_document_immutable/i.test(sql), "error marker sealed_match_document_immutable missing");
must(/create\s+trigger\s+match_documents_sealed_immutability_trg[\s\S]*before\s+update\s+or\s+delete\s+on\s+public\.match_documents/i.test(sql),
  "match_documents_sealed_immutability_trg (BEFORE UPDATE OR DELETE) missing");
must(/for\s+each\s+row/i.test(sql), "FOR EACH ROW missing");

// Out-of-scope negative checks on this migration only
const forbidden = [
  [/alter\s+table[^;]*(force\s+row\s+level\s+security|enable\s+row\s+level\s+security|disable\s+row\s+level\s+security)/i, "must not change RLS"],
  [/create\s+policy|drop\s+policy|alter\s+policy/i, "must not change policies"],
  [/\bgrant\b|\brevoke\b/i, "must not change grants"],
  [/alter\s+table[^;]*owner\s+to/i, "must not change ownership"],
  [/storage\./i, "must not touch storage schema"],
  [/legal_hold/i, "must not touch legal-hold logic"],
];
for (const [re, msg] of forbidden) {
  if (re.test(sql)) fail(msg);
}

console.log(`[batch-j2] OK: ${migPath} installs sealed-match-document full-freeze trigger`);
console.log(`[batch-j2] marker: ${MARKER}`);
