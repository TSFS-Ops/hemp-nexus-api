/**
 * Batch V-UI — IdvBlockerNotice recognises the seven controlled-action
 * blocker codes and never renders raw JSON / stack traces.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseIdvBlockerResponse } from "@/components/idv/IdvBlockerNotice";

const BLOCKER_CODES = [
  "IDV_REQUIRED_WAD_SEAL",
  "IDV_REQUIRED_FINALITY",
  "IDV_REQUIRED_FUNDER_READY",
  "IDV_REQUIRED_API_READY",
  "IDV_REQUIRED_BINDING_POI",
  "IDV_REQUIRED_EVIDENCE_APPROVAL",
  "IDV_REQUIRED_TRANSACTION_APPROVAL",
  "IDV_REQUIRED_NO_SUBJECT",
];

describe("Batch V-UI — IdvBlockerNotice", () => {
  it("parses 409 IDV_* responses into blocker props", () => {
    for (const code of BLOCKER_CODES) {
      const parsed = parseIdvBlockerResponse(409, {
        blocker_code: code,
        user_message: "Test message",
      });
      expect(parsed).not.toBeNull();
      expect(parsed?.blocker_code).toBe(code);
    }
  });

  it("returns null for non-409 status", () => {
    expect(parseIdvBlockerResponse(200, { blocker_code: "IDV_REQUIRED_WAD_SEAL" })).toBeNull();
  });

  it("returns null for non-IDV blocker codes", () => {
    expect(parseIdvBlockerResponse(409, { blocker_code: "OTHER_BLOCK" })).toBeNull();
  });

  it("source file has a friendly title for every controlled-action code", () => {
    const src = readFileSync("src/components/idv/IdvBlockerNotice.tsx", "utf8");
    for (const code of BLOCKER_CODES) {
      expect(src.includes(code), `${code} missing from friendly title map`).toBe(true);
    }
  });

  it("does not include raw JSON.stringify or stack references in the notice", () => {
    const src = readFileSync("src/components/idv/IdvBlockerNotice.tsx", "utf8");
    expect(src.includes("JSON.stringify")).toBe(false);
    expect(src.includes(".stack")).toBe(false);
  });
});
