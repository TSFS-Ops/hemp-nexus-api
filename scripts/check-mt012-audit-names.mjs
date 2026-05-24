#!/usr/bin/env node
/**
 * MT-012 — Trade Request Archive audit-name SSOT drift guard.
 *
 * Asserts:
 *  1. The four canonical audit action constants are present in both the
 *     client SSOT and the Deno mirror.
 *  2. The latest MT-012 migration emits all four canonical action names.
 *  3. No MT-012 RPC body references payment or credit ledger surfaces
 *     (atomic_token_burn, credits.*, payment.*, paystack, token_ledger).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CANONICAL = [
  "trade_request.archive_blocked_active_child_matches",
  "trade_request.archived_admin_override_active_children",
  "trade_request.archived_normal",
  "trade_request.admin_exception_hold_released",
];

const failures = [];
const fail = (m) => failures.push(m);

const client = readFileSync("src/lib/trade-request/mt-012-audit.ts", "utf8");
const deno = readFileSync("supabase/functions/_shared/mt-012-audit.ts", "utf8");
for (const n of CANONICAL) {
  if (!client.includes(`"${n}"`)) fail(`Client SSOT missing canonical: ${n}`);
  if (!deno.includes(`"${n}"`)) fail(`Deno SSOT missing canonical: ${n}`);
}

// Locate the MT-012 migration (any migration that defines the override RPC).
const migDir = "supabase/migrations";
const migFiles = readdirSync(migDir).filter((f) => f.endsWith(".sql"));
const mt012 = migFiles
  .map((f) => ({ f, body: readFileSync(join(migDir, f), "utf8") }))
  .filter((x) => x.body.includes("admin_archive_trade_request_override"))
  .pop();
if (!mt012) {
  fail("MT-012 migration not found (no body defines admin_archive_trade_request_override).");
} else {
  for (const n of CANONICAL) {
    if (!mt012.body.includes(`'${n}'`) && !mt012.body.includes(`"${n}"`)) {
      fail(`Migration ${mt012.f} does not emit canonical name: ${n}`);
    }
  }
  const FORBIDDEN = [
    "atomic_token_burn",
    "token_ledger",
    "credits.purchased",
    "credits.granted",
    "payment.",
    "paystack",
  ];
  for (const term of FORBIDDEN) {
    if (mt012.body.toLowerCase().includes(term.toLowerCase())) {
      fail(`Migration ${mt012.f} must not reference payment/credit surface: ${term}`);
    }
  }
}

if (failures.length) {
  console.error("\n❌ MT-012 audit-name guard FAILED:\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
console.log(
  `✓ MT-012 audit-name guard: ${CANONICAL.length} canonical action(s) pinned in client + Deno SSOTs and migration body.`,
);
