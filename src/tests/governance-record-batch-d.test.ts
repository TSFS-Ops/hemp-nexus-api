/**
 * Batch D — client-side categorisation tests for waiver/bypass events.
 */

import { describe, it, expect } from "vitest";
import { categoriseAction } from "@/lib/governance/governance-record";

describe("Batch D — governance.waiver/bypass categorisation", () => {
  it("granted/renewed → waiver_grant", () => {
    expect(categoriseAction("governance.waiver_granted")).toBe("waiver_grant");
    expect(categoriseAction("governance.waiver_renewed")).toBe("waiver_grant");
    expect(categoriseAction("governance.bypass_granted")).toBe("waiver_grant");
    expect(categoriseAction("governance.bypass_renewed")).toBe("waiver_grant");
  });

  it("consumed → waiver_consumed", () => {
    expect(categoriseAction("governance.waiver_consumed")).toBe("waiver_consumed");
    expect(categoriseAction("governance.bypass_consumed")).toBe("waiver_consumed");
  });

  it("expired → waiver_expired", () => {
    expect(categoriseAction("governance.waiver_expired")).toBe("waiver_expired");
    expect(categoriseAction("governance.bypass_expired")).toBe("waiver_expired");
  });

  it("does not fold into hq_decision or sensitive_admin", () => {
    for (const ev of [
      "governance.waiver_granted",
      "governance.bypass_consumed",
      "governance.waiver_expired",
    ]) {
      const cat = categoriseAction(ev);
      expect(cat).not.toBe("hq_decision");
      expect(cat).not.toBe("sensitive_admin");
    }
  });
});
