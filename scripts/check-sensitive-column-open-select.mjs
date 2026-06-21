#!/usr/bin/env node
// Prebuild guard: any table that defines a column whose name ends with a
// sensitivity marker (_admin_only, _internal, _private, _sensitive,
// _secret) must NOT carry an open SELECT policy
// (`USING (true)` granted to `authenticated`, `anon`, or `public`).
//
// Scans the migration history for the latest CREATE TABLE definition of
// each such table and then checks that no surviving CREATE POLICY block
// grants broad reads. Drops are honoured: if a later migration drops the
// policy, it stops being a violation.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIG_DIR = "supabase/migrations";
const SENSITIVE_SUFFIX = /\b\w+_(admin_only|internal|private|sensitive|secret)\b/i;
const ALLOW = {}; // table_name -> written justification

const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();

// 1) Find tables that contain a sensitive column.
const sensitiveTables = new Set();
for (const f of files) {
  const sql = readFileSync(join(MIG_DIR, f), "utf8");
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let m;
  while ((m = createRe.exec(sql))) {
    const [, table, body] = m;
    if (SENSITIVE_SUFFIX.test(body)) sensitiveTables.add(table);
  }
  // ALTER TABLE ... ADD COLUMN ..._admin_only
  const alterRe = /ALTER\s+TABLE\s+(?:public\.)?([a-zA-Z0-9_]+)\s+ADD\s+COLUMN[\s\S]*?_(?:admin_only|internal|private|sensitive|secret)\b/gi;
  while ((m = alterRe.exec(sql))) sensitiveTables.add(m[1]);
}

// 2) Walk migrations in order; record current policy set per (table, name).
const currentPolicies = new Map(); // `${table}::${name}` -> { roles, isOpenSelect }

for (const f of files) {
  const sql = readFileSync(join(MIG_DIR, f), "utf8");

  // DROP POLICY ... ON table;
  const dropRe = /DROP\s+POLICY(?:\s+IF\s+EXISTS)?\s+"?([^"\s]+)"?\s+ON\s+(?:public\.)?([a-zA-Z0-9_]+)\s*;/gi;
  let m;
  while ((m = dropRe.exec(sql))) {
    currentPolicies.delete(`${m[2]}::${m[1]}`);
  }

  // CREATE POLICY "name" ON table ... ;
  const createRe = /CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(?:public\.)?([a-zA-Z0-9_]+)([\s\S]*?);/gi;
  while ((m = createRe.exec(sql))) {
    const [, name, table, body] = m;
    if (!sensitiveTables.has(table)) continue;
    if (!/FOR\s+SELECT/i.test(body)) continue;
    const toAuth = /TO\s+(authenticated|anon|public)\b/i.test(body);
    const usingTrue = /USING\s*\(\s*true\s*\)/i.test(body);
    currentPolicies.set(`${table}::${name}`, {
      table, name, toAuth, usingTrue, file: f,
    });
  }
}

const violations = [];
for (const p of currentPolicies.values()) {
  if (ALLOW[p.table]) continue;
  if (p.toAuth && p.usingTrue) {
    violations.push(
      `${p.file}: ${p.table}.${p.name} grants open SELECT (USING true) to anon/authenticated on a table containing _admin_only/_internal/_private/_sensitive/_secret columns`,
    );
  }
}

if (violations.length) {
  console.error("❌ sensitive-column open-SELECT guard failed:");
  for (const v of violations) console.error("  - " + v);
  process.exit(1);
}
console.log(`✓ sensitive-column open-SELECT guard passed (${sensitiveTables.size} sensitive tables scanned)`);
