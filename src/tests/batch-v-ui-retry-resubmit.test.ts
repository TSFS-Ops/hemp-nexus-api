/**
 * Batch V-UI — retry / resubmit CTA logic for the IDV status widget.
 *
 * Verifies that the resubmit-eligible statuses map to safe labels
 * and route through /desk/idv/start?resubmit=1&reason=<status>.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { idvSafeLabel, IDV_BANNED_WORDING } from "@/components/idv/idv-status-labels";

const RESUBMIT_STATES = [
  "retry_required",
  "alternative_document_required",
  "failed",
  "expired",
  "error",
  "provider_error",
] as const;

describe("Batch V-UI — retry / resubmit flow", () => {
  it("every resubmit-eligible state has a safe label and next action", () => {
    for (const s of RESUBMIT_STATES) {
      const l = idvSafeLabel(s);
      expect(l.label).toBeTruthy();
      expect(l.next_action).toBeTruthy();
      const hay = `${l.label} ${l.next_action}`.toLowerCase();
      for (const bad of IDV_BANNED_WORDING) {
        expect(hay.includes(bad)).toBe(false);
      }
    }
  });

  it("status widget wires resubmit CTA to /desk/idv/start with reason", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/idv/IdvStatusWidget.tsx"),
      "utf8",
    );
    expect(src).toContain("resubmit=1");
    expect(src).toContain("idv-resubmit-cta");
    expect(src).toContain("idv-start-cta");
    for (const s of RESUBMIT_STATES) {
      expect(src).toContain(`"${s}"`);
    }
  });

  it("start screen renders a resubmit banner when resubmit=1", () => {
    const src = readFileSync(
      join(process.cwd(), "src/pages/desk/idv/IdvStart.tsx"),
      "utf8",
    );
    expect(src).toContain("idv-resubmit-banner");
    expect(src).toContain("useSearchParams");
    expect(src).toContain('resubmit') ;
  });
});
