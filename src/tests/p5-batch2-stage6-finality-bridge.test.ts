import { describe, expect, it } from "vitest";
import { buildP5B2Checklist } from "@/lib/p5-batch2/checklist-engine";
import { bridgeP5B2Readiness } from "@/lib/p5-batch2/readiness-bridge";
import {
  evaluateP5B2FinalityGuard,
  isP5B2FinalityBlocked,
} from "@/lib/p5-batch2/finality-bridge";

const NOW = "2026-06-24T12:00:00.000Z";

function chk(opts: Partial<Parameters<typeof buildP5B2Checklist>[0]> = {}) {
  return buildP5B2Checklist({
    record_type: "company", jurisdiction: "ZA", entity_type: "PTY",
    transaction_type: null, finality_condition: "at_finality",
    funder_rule: "none", api_rule: "none", provider_dependency: false,
    now: NOW, ...opts,
  });
}

describe("p5-batch2 stage 6 finality bridge", () => {
  it("blocks finality on missing mandatory evidence", () => {
    const deltas = bridgeP5B2Readiness({ checklist: chk() });
    const verdict = evaluateP5B2FinalityGuard({ deltas });
    expect(verdict.verdict).toBe("blocked");
    expect(verdict.hard_blockers.length).toBeGreaterThan(0);
    expect(isP5B2FinalityBlocked(deltas)).toBe(true);
  });

  it("blocks finality when bank details changed and not re-approved", () => {
    const deltas = bridgeP5B2Readiness({
      checklist: chk(), bank_details_changed_pending_approval: true,
    });
    const v = evaluateP5B2FinalityGuard({ deltas });
    expect(v.verdict).toBe("blocked");
    expect(v.reasons.some((r) => r.includes("bank_details_changed_pending_approval"))).toBe(true);
  });

  it("provider-dependent never grants finality clearance", () => {
    const deltas = bridgeP5B2Readiness({
      checklist: chk({
        provider_dependency: true,
        existing_evidence: [
          { key: "bank_confirmation", status: "provider_dependent", expiry_date: null,
            provider_dependency: true, provider_live: false, reviewed_at: null },
        ],
      }),
    });
    const v = evaluateP5B2FinalityGuard({ deltas });
    expect(v.verdict).not.toBe("clear");
  });

  it("uploaded-unreviewed mandatory blocks finality", () => {
    const deltas = bridgeP5B2Readiness({
      checklist: chk({
        existing_evidence: [
          { key: "company_registration", status: "uploaded", expiry_date: null,
            provider_dependency: false, provider_live: false, reviewed_at: null },
        ],
      }),
    });
    expect(isP5B2FinalityBlocked(deltas)).toBe(true);
  });

  it("optional missing items do not block", () => {
    // Synthesize a checklist with no missing mandatory: all keys waived.
    const allKeys = chk().all_requirements.map((r) => r.key);
    const deltas = bridgeP5B2Readiness({
      checklist: chk({ waivers: allKeys, active_waiver_scopes: ["execution", "finality", "compliance"] }),
      active_waiver_scopes: ["execution", "finality", "compliance"],
    });
    // With all waived within scope, should not be hard-blocked.
    expect(isP5B2FinalityBlocked(deltas)).toBe(false);
  });
});
