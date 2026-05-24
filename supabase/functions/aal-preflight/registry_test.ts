/**
 * SEC-001-FU-001 — registry-level Deno test for aal-preflight.
 *
 * Imports the live `ACTION_AAL_REQUIREMENTS` registry and asserts:
 *   - every SEC-001 + DATA-010 canonical key is present and `aal2`;
 *   - every value is `aal2` (the registry has no aal1 downgrades today);
 *   - `break_glass` is intentionally absent (uses GoTrue password re-auth);
 *   - no duplicate or empty keys;
 *   - keys conform to the `<domain>.<action>` shape.
 */
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { ACTION_AAL_REQUIREMENTS } from "./index.ts";

const REQUIRED_KEYS = [
  // SEC-001 sensitive admin mutations
  "entity.mutate",
  "organisation.mutate",
  "authority.bind",
  "trade.approval_override",
  "pending_engagement.send_outreach",
  "reputation.recalculate",
  // Pre-existing money-movement / governance gates relied on by SEC-001
  "admin.credit_org",
  "admin.lifecycle_scheduler.invoke",
  "admin.match_legacy_repair",
  "admin.manual_override",
  // DATA-010 Phase 1 sensitive export gate
  "export.admin_pii_export",
  // SEC-001 follow-up — fixture password-recovery dispatch
  "admin.user_recovery_dispatch",
  // SEC-001 follow-up — governance-doc validate (token burn)
  "governance.doc_validate",
];

Deno.test("registry: every required SEC-001 + DATA-010 key is present and aal2", () => {
  for (const key of REQUIRED_KEYS) {
    assertEquals(
      ACTION_AAL_REQUIREMENTS[key],
      "aal2",
      `expected ${key} to be registered as aal2`,
    );
  }
});

Deno.test("registry: every registered value is aal2 (no aal1 downgrades today)", () => {
  for (const [key, value] of Object.entries(ACTION_AAL_REQUIREMENTS)) {
    assertEquals(
      value,
      "aal2",
      `registry key ${key} has unexpected value ${value} — only aal2 is allowed today; document the exception before downgrading`,
    );
  }
});

Deno.test("registry: break_glass is deliberately absent (GoTrue password re-auth)", () => {
  assertFalse(
    Object.prototype.hasOwnProperty.call(ACTION_AAL_REQUIREMENTS, "break_glass"),
    "break_glass must NOT be in the preflight registry — it uses fresh password re-auth via GoTrue, not the JWT aal claim",
  );
});

Deno.test("registry: no empty keys and no obvious duplicates after normalisation", () => {
  const keys = Object.keys(ACTION_AAL_REQUIREMENTS);
  assert(keys.length > 0, "registry must not be empty");
  for (const k of keys) {
    assert(k.trim().length > 0, "registry key is empty/whitespace");
  }
  const lower = keys.map((k) => k.toLowerCase());
  const unique = new Set(lower);
  assertEquals(
    unique.size,
    lower.length,
    "registry contains case-insensitive duplicate keys",
  );
});

Deno.test("registry: every key follows the <domain>.<action> naming shape", () => {
  for (const k of Object.keys(ACTION_AAL_REQUIREMENTS)) {
    assert(
      /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(k),
      `registry key "${k}" violates the <domain>.<action> naming shape`,
    );
  }
});
