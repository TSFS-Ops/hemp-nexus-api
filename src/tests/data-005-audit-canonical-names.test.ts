/**
 * DATA-005 Phase 1 — canonical audit-name pins.
 *
 * Source-level assertions on supabase/functions/user-export-request/index.ts:
 *   - Phase 1 audit names MUST be emitted from the edge function.
 *   - Phase 2 audit names MUST NOT be emitted in Phase 1 (they may
 *     appear as declared constants in the SSOT only).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PHASE1_AUDIT_NAMES,
  PHASE2_AUDIT_NAMES,
} from "@/lib/user-export-categories";

const FN_SRC = readFileSync(
  join(process.cwd(), "supabase/functions/user-export-request/index.ts"),
  "utf8",
);

describe("DATA-005 — canonical audit names", () => {
  it("pins the exact Phase 1 audit names", () => {
    expect(PHASE1_AUDIT_NAMES).toEqual([
      "data.user_export_requested",
      "data.user_export_scope_resolved",
      "data.user_export_blocked_or_declined",
    ]);
  });

  it("pins the exact Phase 2 audit names (deferred, not emitted in Phase 1)", () => {
    expect(PHASE2_AUDIT_NAMES).toEqual([
      "data.user_export_generated",
      "data.user_export_downloaded",
      "data.user_export_file_destroyed",
    ]);
  });

  it("user-export-request emits all three Phase 1 audit names", () => {
    for (const name of PHASE1_AUDIT_NAMES) {
      expect(FN_SRC).toContain(`"${name}"`);
    }
  });

  it("user-export-request does NOT emit any Phase 2 audit name (outside comments)", () => {
    for (const name of PHASE2_AUDIT_NAMES) {
      const lines = FN_SRC.split("\n");
      const emittingLine = lines.findIndex((line) => {
        if (!line.includes(`"${name}"`)) return false;
        const trimmed = line.trim();
        return !trimmed.startsWith("//") && !trimmed.startsWith("*");
      });
      expect(emittingLine).toBe(-1);
    }
  });
});
