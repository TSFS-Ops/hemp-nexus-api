/**
 * DATA-003 Phase 1 — audit-name parity guard test.
 *
 * Wraps `scripts/check-legal-hold-audit-names.mjs` (which runs in
 * `prebuild`) so the same canonical-name contract is enforced inside the
 * vitest suite too. If any of these names drift, both prebuild AND the
 * regression suite fail loudly:
 *
 *   - data.legal_hold_applied
 *   - data.legal_hold_released
 *   - data.deletion_blocked_legal_hold
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  LEGAL_HOLD_AUDIT_NAMES,
} from "../../supabase/functions/_shared/legal-hold";

const ROOT = resolve(__dirname, "..", "..");

describe("DATA-003 — audit-name parity guard", () => {
  it("canonical names match the shared helper constants", () => {
    expect(LEGAL_HOLD_AUDIT_NAMES.applied).toBe("data.legal_hold_applied");
    expect(LEGAL_HOLD_AUDIT_NAMES.released).toBe("data.legal_hold_released");
    expect(LEGAL_HOLD_AUDIT_NAMES.deletion_blocked).toBe(
      "data.deletion_blocked_legal_hold",
    );
  });

  it("scripts/check-legal-hold-audit-names.mjs passes against current source", () => {
    // Exits non-zero on drift; vitest will surface stderr.
    expect(() => {
      execFileSync("node", ["scripts/check-legal-hold-audit-names.mjs"], {
        cwd: ROOT,
        stdio: "pipe",
      });
    }).not.toThrow();
  });

  it("helper emits data.deletion_blocked_legal_hold (not legacy / renamed)", () => {
    const src = readFileSync(
      resolve(ROOT, "supabase/functions/_shared/legal-hold.ts"),
      "utf8",
    );
    expect(src).toMatch(/action:\s*"data\.deletion_blocked_legal_hold"/);
  });

  it("admin-legal-hold emits LEGAL_HOLD_AUDIT_NAMES.applied + released", () => {
    const src = readFileSync(
      resolve(ROOT, "supabase/functions/admin-legal-hold/index.ts"),
      "utf8",
    );
    expect(src).toMatch(/LEGAL_HOLD_AUDIT_NAMES\.applied/);
    expect(src).toMatch(/LEGAL_HOLD_AUDIT_NAMES\.released/);
  });
});
