/**
 * Batch V-Wire — Per-path consumption proof.
 *
 * Scans the six controlled-action edge functions to prove each one
 * imports the actor IDV gate helper and calls it with the correct
 * `ControlledAction` string. WaD seal path is asserted separately in
 * batch-v-controlled-action-gate.test.ts.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const WIRED: Array<{ file: string; action: string; blocker: string }> = [
  {
    file: "supabase/functions/p5-batch4-execution-summary/index.ts",
    action: "finality_action",
    blocker: "IDV_REQUIRED_FINALITY",
  },
  {
    file: "supabase/functions/p5-batch3-funder-summary/index.ts",
    action: "funder_ready_grant",
    blocker: "IDV_REQUIRED_FUNDER_READY",
  },
  {
    file: "supabase/functions/registry-readiness-transition/index.ts",
    action: "api_ready_true",
    blocker: "IDV_REQUIRED",
  },
  {
    file: "supabase/functions/poi-transition/index.ts",
    action: "poi_bind_party",
    blocker: "IDV_REQUIRED_BINDING_POI",
  },
  {
    file: "supabase/functions/registry-claim-review/index.ts",
    action: "evidence_approval",
    blocker: "IDV_REQUIRED_EVIDENCE_APPROVAL",
  },
  {
    file: "supabase/functions/trade-approval/index.ts",
    action: "transaction_approval",
    blocker: "IDV_REQUIRED_TRANSACTION_APPROVAL",
  },
];

describe("Batch V-Wire — per-path IDV gate consumption", () => {
  it.each(WIRED)("$file wires $action → $blocker", ({ file, action, blocker }) => {
    const src = readFileSync(file, "utf8");
    expect(src, "imports actor gate").toContain("assertActorIdvGate");
    expect(src, "imports IdvGateError").toContain("IdvGateError");
    expect(src, `calls gate with "${action}"`).toContain(`"${action}"`);
    expect(src, `surfaces blocker code ${blocker}`).toContain(blocker);
  });

  it("WaD seal path remains wired", () => {
    const wad = readFileSync("supabase/functions/wad/index.ts", "utf8");
    expect(wad).toContain("assertWadSealIdvGate");
  });

  it("no target file introduces old-provider names", () => {
    const banned = ["dilisense", "sanctions_io", "sumsub", "didit", "complycube", "onfido"];
    for (const { file } of WIRED) {
      const src = readFileSync(file, "utf8").toLowerCase();
      for (const b of banned) expect(src, `${file} must not name ${b}`).not.toContain(b);
    }
  });

  it("no target file uses unsafe trust wording", () => {
    const banned = ["cleared identity", "risk-free", "aml passed"];
    for (const { file } of WIRED) {
      const src = readFileSync(file, "utf8").toLowerCase();
      for (const b of banned) expect(src, `${file} must not use "${b}"`).not.toContain(b);
    }
  });
});
