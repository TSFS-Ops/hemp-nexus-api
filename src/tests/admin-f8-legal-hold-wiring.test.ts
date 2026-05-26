/**
 * Batch F8 — admin-legal-hold wiring tests (proof-pack).
 *
 * The endpoint was already atomic on the critical path via the SQL RPCs
 * `atomic_legal_hold_apply` / `atomic_legal_hold_release`. F8 adds:
 *   - static wiring assertions that the atomic RPCs are still the writers,
 *   - no use of legacy `recordAdminHqDecision`,
 *   - no `writeCriticalEventWithPosture` calls on the happy paths,
 *   - the unused import has been cleaned up,
 *   - AAL2 + platform_admin gates remain,
 *   - post-commit mirror writers stay as legacy mirrors (not RPC writers),
 *   - the endpoint requires `governance_event_id` on success.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "..", "..", "supabase/functions/admin-legal-hold/index.ts"),
  "utf8",
);

describe("F8 — admin-legal-hold uses atomic RPCs", () => {
  it("calls atomic_legal_hold_apply", () => {
    expect(SRC).toMatch(/\.rpc\(\s*["']atomic_legal_hold_apply["']/);
  });
  it("calls atomic_legal_hold_release", () => {
    expect(SRC).toMatch(/\.rpc\(\s*["']atomic_legal_hold_release["']/);
  });
  it("passes p_governance to both atomic RPCs", () => {
    const applyBlock = SRC.match(
      /atomic_legal_hold_apply["'][\s\S]*?\}\s*,\s*\)/,
    )?.[0] ?? "";
    const releaseBlock = SRC.match(
      /atomic_legal_hold_release["'][\s\S]*?\}\s*,\s*\)/,
    )?.[0] ?? "";
    expect(applyBlock).toMatch(/p_governance:/);
    expect(releaseBlock).toMatch(/p_governance:/);
  });
});

describe("F8 — no legacy split-commit writers on happy path", () => {
  it("does NOT call recordAdminHqDecision", () => {
    expect(SRC).not.toMatch(/recordAdminHqDecision/);
  });
  it("does NOT call writeCriticalEventWithPosture", () => {
    expect(SRC).not.toMatch(/writeCriticalEventWithPosture/);
  });
  it("does NOT import writeCriticalEventWithPosture (cleanup)", () => {
    expect(SRC).not.toMatch(/writeCriticalEventWithPosture/);
  });
  it("still imports buildPostureSnapshot (used to construct posture)", () => {
    expect(SRC).toMatch(/import\s*\{\s*buildPostureSnapshot\s*\}/);
    expect(SRC).toMatch(/buildPostureSnapshot\(/);
  });
});

describe("F8 — security gates preserved", () => {
  it("requires Bearer token via admin.auth.getUser", () => {
    expect(SRC).toMatch(/admin\.auth\.getUser\(token\)/);
  });
  it("enforces platform_admin via has_role", () => {
    expect(SRC).toMatch(
      /\.rpc\(\s*["']has_role["']\s*,\s*\{[\s\S]*?_role:\s*["']platform_admin["']/,
    );
  });
  it("enforces AAL2 via assertAal2", () => {
    expect(SRC).toMatch(/assertAal2\(authHeader/);
    expect(SRC).toMatch(/MFA_REQUIRED/);
  });
});

describe("F8 — governance_event_id is required to surface success", () => {
  it("apply returns GOV_AUDIT_WRITE_FAILED if governance_event_id missing", () => {
    // Two distinct branches (apply + release) both fail-closed.
    const matches = SRC.match(/governance_event_id/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
    expect(SRC).toMatch(/code:\s*["']GOV_AUDIT_WRITE_FAILED["']/);
  });
  it("apply error path includes 'Hold rolled back: governance proof write failed'", () => {
    expect(SRC).toContain("Hold rolled back: governance proof write failed");
  });
  it("release error path includes 'Hold release rolled back: governance proof write failed'", () => {
    expect(SRC).toContain(
      "Hold release rolled back: governance proof write failed",
    );
  });
});

describe("F8 — legacy mirror writers remain but are clearly mirrors", () => {
  it("retains audit_logs mirror via writeCanonicalAudit", () => {
    expect(SRC).toMatch(/writeCanonicalAudit\(/);
    expect(SRC).toMatch(/from\(["']audit_logs["']\)\s*\.insert/);
  });
  it("retains admin_audit_logs mirror via writeAdminAudit", () => {
    expect(SRC).toMatch(/writeAdminAudit\(/);
    expect(SRC).toMatch(/from\(["']admin_audit_logs["']\)\s*\.insert/);
  });
  it("mirror writers swallow their own errors (best-effort, not part of atomic tx)", () => {
    // Both helpers wrap their insert in try/catch logging only — confirming
    // they are mirrors, not the canonical writer.
    const canonical = SRC.match(/async function writeCanonicalAudit[\s\S]*?\n\}\n/)?.[0] ?? "";
    const adminAudit = SRC.match(/async function writeAdminAudit[\s\S]*?\n\}\n/)?.[0] ?? "";
    expect(canonical).toMatch(/try\s*\{[\s\S]*?\}\s*catch/);
    expect(adminAudit).toMatch(/try\s*\{[\s\S]*?\}\s*catch/);
  });
  it("mirror writers run AFTER the atomic RPC success branch (not before)", () => {
    const rpcApplyIdx = SRC.indexOf('"atomic_legal_hold_apply"');
    const mirrorIdx = SRC.indexOf("writeCanonicalAudit(admin, LEGAL_HOLD_AUDIT_NAMES.applied");
    expect(rpcApplyIdx).toBeGreaterThan(-1);
    expect(mirrorIdx).toBeGreaterThan(rpcApplyIdx);
  });
});
