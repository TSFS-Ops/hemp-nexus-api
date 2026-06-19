/**
 * Facilitation Batch 11 — Invite Unopened Auto-Detector unit tests.
 *
 * Pure helper coverage — no edge-function network calls. Behavioural
 * server tests live in the facilitation UAT.
 *
 * What this proves:
 *   1. exactly 3 business days unopened qualifies
 *   2. less than 3 business days does not qualify
 *   3. opened/replied send does not qualify
 *   4. terminal parent case is skipped (even at the threshold)
 *   5. already-flagged send is skipped
 *   6. SLA-reminder-covered case is skipped
 *   7. delivery-failed send is skipped
 *   8. never-sent send is skipped
 *   9. weekends are excluded from the business-day count
 *  10. canonical audit name + next-step kind are pinned in browser SSOT
 *  11. detector module imports no forbidden side-effect paths (defence-in-depth)
 *  12. buildNextStepRow produces a row with the canonical kind + safe payload
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  businessDaysBetween,
  decideFlag,
  buildNextStepRow,
  INVITE_UNOPENED_NEXT_STEP_KIND,
  INVITE_UNOPENED_AUDIT_NAME,
  INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD,
  type DetectorSendInput,
} from "../../supabase/functions/_shared/facilitation-invite-unopened.ts";
import { FACILITATION_AUDIT_NAMES, TERMINAL_STATUSES } from "@/lib/facilitation-case-state";

const TERMINAL: ReadonlySet<string> = TERMINAL_STATUSES as unknown as ReadonlySet<string>;

// Anchor on a Monday so weekday math is unambiguous.
// 2026-06-01 is a Monday (UTC).
const MON = (h = 10) => new Date(`2026-06-0${1}T${String(h).padStart(2, "0")}:00:00Z`);
const dayAt = (d: number, h = 10) =>
  new Date(`2026-06-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`);

function input(over: Partial<DetectorSendInput> = {}): DetectorSendInput {
  return {
    send_id: "send-1",
    case_id: "case-1",
    sent_at: MON().toISOString(),
    send_status: "sent",
    case_internal_status: "awaiting_counterparty_response",
    already_flagged: false,
    sla_reminder_covered: false,
    ...over,
  };
}

describe("Batch 11 — businessDaysBetween", () => {
  it("(9a) Mon→Thu = 3 business days", () => {
    expect(businessDaysBetween(dayAt(1), dayAt(4))).toBe(3);
  });
  it("(9b) Fri→Mon = 1 business day (weekends excluded)", () => {
    // 2026-06-05 Fri → 2026-06-08 Mon
    expect(businessDaysBetween(dayAt(5), dayAt(8))).toBe(1);
  });
  it("(9c) same day = 0", () => {
    expect(businessDaysBetween(dayAt(1), dayAt(1))).toBe(0);
  });
  it("(9d) reversed range = 0", () => {
    expect(businessDaysBetween(dayAt(4), dayAt(1))).toBe(0);
  });
});

describe("Batch 11 — decideFlag", () => {
  it("(1) exactly 3 business days unopened qualifies", () => {
    const d = decideFlag(input({ sent_at: dayAt(1).toISOString() }), dayAt(4), TERMINAL);
    expect(d.action).toBe("flag");
    expect(d.business_days).toBeGreaterThanOrEqual(INVITE_UNOPENED_BUSINESS_DAYS_THRESHOLD);
  });
  it("(2) <3 business days does not qualify", () => {
    const d = decideFlag(input({ sent_at: dayAt(1).toISOString() }), dayAt(3), TERMINAL);
    expect(d.action).toBe("skip");
    if (d.action === "skip") expect(d.reason).toBe("too_recent");
  });
  it("(3a) opened send does not qualify", () => {
    const d = decideFlag(input({ send_status: "opened" }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "engaged" });
  });
  it("(3b) replied send does not qualify", () => {
    const d = decideFlag(input({ send_status: "replied" }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "engaged" });
  });
  it("(4) terminal parent case is skipped at threshold", () => {
    const d = decideFlag(input({ case_internal_status: "closed" }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "terminal_case" });
  });
  it("(5) already-flagged send is skipped", () => {
    const d = decideFlag(input({ already_flagged: true }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "already_flagged" });
  });
  it("(6) SLA-reminder-covered case is skipped", () => {
    const d = decideFlag(input({ sla_reminder_covered: true }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "sla_reminder_covered" });
  });
  it("(7) delivery-failed send is skipped", () => {
    const d = decideFlag(input({ send_status: "bounced" }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "delivery_failed" });
  });
  it("(8) never-sent send is skipped", () => {
    const d = decideFlag(input({ sent_at: null }), dayAt(4), TERMINAL);
    expect(d).toMatchObject({ action: "skip", reason: "never_sent" });
  });
});

describe("Batch 11 — SSOT + payload contracts", () => {
  it("(10) canonical audit name + kind pinned in browser SSOT", () => {
    expect((FACILITATION_AUDIT_NAMES as readonly string[]).includes(INVITE_UNOPENED_AUDIT_NAME)).toBe(true);
    expect(INVITE_UNOPENED_NEXT_STEP_KIND).toBe("invite_unopened_3bd");
    expect(INVITE_UNOPENED_AUDIT_NAME).toBe("facilitation_case.invite_unopened_flagged");
  });

  it("(11) detector edge function has no forbidden side-effect imports", () => {
    const src = readFileSync(
      resolve(__dirname, "../../supabase/functions/facilitation-invite-unopened-detector/index.ts"),
      "utf8",
    );
    for (const re of [
      /send-transactional-email/i,
      /notification-dispatch/i,
      /resend\.emails\.send/i,
      /atomic_generate_poi/i,
      /atomic_token_burn/i,
      /from\(["']wads["']\)[\s\S]{0,80}\.insert\(/i,
      /from\(["']matches["']\)[\s\S]{0,80}\.insert\(/i,
      /from\(["']pois["']\)[\s\S]{0,80}\.insert\(/i,
      /from\(["']token_ledger["']\)[\s\S]{0,80}\.insert\(/i,
      /from\(["']facilitation_cases["']\)[\s\S]{0,200}\.update\(/i,
    ]) {
      expect(re.test(src), `forbidden pattern matched: ${re}`).toBe(false);
    }
  });

  it("(12) buildNextStepRow yields the canonical payload shape", () => {
    const row = buildNextStepRow({
      case_id: "case-1",
      send_id: "send-1",
      sent_at: MON().toISOString(),
      business_days: 3,
      detector_user_id: "00000000-0000-0000-0000-000000000000",
    });
    expect(row.next_step_type).toBe("invite_unopened_3bd");
    expect(row.status).toBe("open");
    expect(row.title).toMatch(/invite unopened/i);
    expect(row.required_actions).toMatchObject({
      source: "auto_detector",
      kind: "invite_unopened_3bd",
      outreach_send_id: "send-1",
      business_days_at_flag: 3,
    });
  });
});
