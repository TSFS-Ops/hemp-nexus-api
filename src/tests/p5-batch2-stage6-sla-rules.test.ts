import { describe, expect, it } from "vitest";
import { evaluateP5B2Sla } from "@/lib/p5-batch2/sla-rules";

const NOW = "2026-06-24T12:00:00.000Z";

describe("p5-batch2 stage 6 sla rules", () => {
  it("fires expiry reminders at 30/14/7 days", () => {
    for (const d of [30, 14, 7]) {
      const expiry = new Date(Date.parse(NOW) + d * 86400_000).toISOString();
      const out = evaluateP5B2Sla({
        evidence_item_id: "e1", required_before_finality: true, expiry_date: expiry, now: NOW,
      });
      expect(out.some((a) => a.rule_code === `expiry_reminder_${d}d`)).toBe(true);
    }
  });

  it("does not fire expiry reminder on non-threshold days", () => {
    const expiry = new Date(Date.parse(NOW) + 20 * 86400_000).toISOString();
    const out = evaluateP5B2Sla({
      evidence_item_id: "e1", required_before_finality: true, expiry_date: expiry, now: NOW,
    });
    expect(out.find((a) => a.rule_code.startsWith("expiry_reminder"))).toBeUndefined();
  });

  it("escalates missing finality at 48h", () => {
    const since = new Date(Date.parse(NOW) - 49 * 3600_000).toISOString();
    const out = evaluateP5B2Sla({
      evidence_item_id: "e2", required_before_finality: true,
      is_missing_mandatory: true, missing_since: since, now: NOW,
    });
    expect(out.some((a) => a.rule_code === "missing_finality_48h")).toBe(true);
  });

  it("escalates missing non-finality after 5 working days", () => {
    // 10 calendar days ≥ 5 working days
    const since = new Date(Date.parse(NOW) - 10 * 86400_000).toISOString();
    const out = evaluateP5B2Sla({
      evidence_item_id: "e3", required_before_finality: false,
      is_missing_mandatory: true, missing_since: since, now: NOW,
    });
    expect(out.some((a) => a.rule_code === "missing_non_finality_5wd")).toBe(true);
  });

  it("bank change second review fires after 24h", () => {
    const submitted = new Date(Date.parse(NOW) - 25 * 3600_000).toISOString();
    const out = evaluateP5B2Sla({
      evidence_item_id: "b1", required_before_finality: true,
      bank_change_pending: true, bank_change_submitted_at: submitted, now: NOW,
    });
    expect(out.some((a) => a.rule_code === "bank_change_second_review")).toBe(true);
  });

  it("provider follow-up fires after 72h with no follow-up", () => {
    const out = evaluateP5B2Sla({
      evidence_item_id: "p1", required_before_finality: true,
      provider_dependent: true, provider_last_followup_at: null, now: NOW,
    });
    expect(out.some((a) => a.rule_code === "provider_dependent_followup")).toBe(true);
  });

  it("high-risk ubo review fires after 48h", () => {
    const opened = new Date(Date.parse(NOW) - 49 * 3600_000).toISOString();
    const out = evaluateP5B2Sla({
      evidence_item_id: "u1", required_before_finality: true,
      high_risk_ubo: true, high_risk_ubo_opened_at: opened, now: NOW,
    });
    expect(out.some((a) => a.rule_code === "high_risk_ubo_review")).toBe(true);
  });

  it("idempotency keys are stable across reruns", () => {
    const inp = {
      evidence_item_id: "x1", required_before_finality: true, is_missing_mandatory: true,
      missing_since: new Date(Date.parse(NOW) - 72 * 3600_000).toISOString(), now: NOW,
    };
    const a = evaluateP5B2Sla(inp).map((x) => x.idempotency_key).sort();
    const b = evaluateP5B2Sla(inp).map((x) => x.idempotency_key).sort();
    expect(a).toEqual(b);
  });
});
