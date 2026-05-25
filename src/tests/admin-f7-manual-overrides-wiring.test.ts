/**
 * Batch F7 — static wiring guard for admin-manual-overrides.
 *
 * Asserts the endpoint:
 *   1. Calls the atomic `admin_manual_override_with_governance` wrapper.
 *   2. No longer calls `safe_transition_match_state` directly (legacy split path).
 *   3. No longer inserts into `admin_audit_logs` from TypeScript (now handled inside the wrapper).
 *   4. Does NOT import or call `recordAdminHqDecision`.
 *   5. Still enforces AAL2 + platform_admin (assertAal2 + FORBIDDEN).
 *   6. Surfaces `governance_event_id` and `deduplicated` in the response.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../../supabase/functions/admin-manual-overrides/index.ts"),
  "utf8",
);

describe("admin-manual-overrides F7 atomic wiring", () => {
  it("calls the atomic wrapper RPC", () => {
    expect(SRC).toMatch(
      /\.rpc\(\s*[\n\s]*["']admin_manual_override_with_governance["']/,
    );
  });

  it("does NOT call safe_transition_match_state directly", () => {
    expect(SRC).not.toMatch(/\.rpc\(\s*[\n\s]*["']safe_transition_match_state["']/);
  });

  it("does NOT insert into admin_audit_logs from TypeScript", () => {
    expect(SRC).not.toMatch(/from\(\s*["']admin_audit_logs["']\s*\)\s*\.insert/);
  });

  it("does NOT import recordAdminHqDecision", () => {
    expect(SRC).not.toMatch(
      /^\s*import\s+\{[^}]*recordAdminHqDecision[^}]*\}\s+from/m,
    );
  });

  it("does NOT call recordAdminHqDecision", () => {
    expect(SRC).not.toMatch(/\brecordAdminHqDecision\s*\(/);
  });

  it("still enforces AAL2 + platform_admin guard", () => {
    expect(SRC).toMatch(/assertAal2/);
    expect(SRC).toMatch(/FORBIDDEN/);
  });

  it("still requires an Idempotency-Key", () => {
    expect(SRC).toMatch(/assertIdempotencyKey/);
  });

  it("surfaces governance_event_id and deduplicated", () => {
    expect(SRC).toMatch(/governance_event_id/);
    expect(SRC).toMatch(/deduplicated/);
  });

  it("preserves Zod strict body schema for all 4 operations", () => {
    for (const op of ["force_status", "void_match", "rerun_screening", "regenerate_evidence"]) {
      expect(SRC).toMatch(new RegExp(`z\\.literal\\(["']${op}["']\\)`));
    }
  });
});
