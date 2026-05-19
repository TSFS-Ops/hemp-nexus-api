/**
 * CP-002 / DEC-002 — Pending Engagement audit + UI signed contract
 * ──────────────────────────────────────────────────────────────────────────
 *
 * Source: Izenzo_Client_Only_Decision_Form_SIGNED.pdf, CP-002 / DEC-002.
 *
 * Pins (additive, do not remove existing canonical events):
 *   1. UI message includes BOTH signed lines:
 *      • "No contact details yet. Research this counterparty, add a valid
 *         email, then send outreach."
 *      • "Send outreach is disabled until a valid email is added."
 *   2. Edge function `poi-engagements/index.ts` emits all three new signed
 *      audit actions while keeping the canonical
 *      `outreach.blocked.contact_incomplete` and `contact.assigned` /
 *      `contact.updated` events.
 *
 * This is a static source-of-truth pin so a future refactor cannot silently
 * drop the signed wording or audit actions.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PANEL = readFileSync(
  resolve(__dirname, "../components/admin/AdminPendingEngagementsPanel.tsx"),
  "utf8",
);
const EDGE = readFileSync(
  resolve(__dirname, "../../supabase/functions/poi-engagements/index.ts"),
  "utf8",
);

describe("CP-002 / DEC-002 — signed UI wording", () => {
  it("admin panel shows the existing signed no-contact line", () => {
    expect(PANEL).toContain(
      "No contact details yet. Research this counterparty, add a valid email, then send outreach.",
    );
  });
  it("admin panel shows the additional signed disabled-outreach line", () => {
    expect(PANEL).toContain(
      "Send outreach is disabled until a valid email is added.",
    );
  });
});

describe("CP-002 / DEC-002 — signed audit actions", () => {
  it("emits pending_engagement.no_contact_details_detected", () => {
    expect(EDGE).toMatch(/action:\s*"pending_engagement\.no_contact_details_detected"/);
  });
  it("emits pending_engagement.contact_details_added", () => {
    expect(EDGE).toMatch(/action:\s*"pending_engagement\.contact_details_added"/);
  });
  it("emits pending_engagement.outreach_blocked_missing_email", () => {
    expect(EDGE).toMatch(/action:\s*"pending_engagement\.outreach_blocked_missing_email"/);
  });
});

describe("CP-002 / DEC-002 — canonical events preserved (additive only)", () => {
  it("keeps canonical outreach.blocked.contact_incomplete", () => {
    expect(EDGE).toMatch(/action:\s*"outreach\.blocked\.contact_incomplete"/);
  });
  it("keeps canonical contact.assigned / contact.updated emitter", () => {
    expect(EDGE).toMatch(/wasUnset\s*\?\s*"contact\.assigned"\s*:\s*"contact\.updated"/);
  });
  it("does NOT introduce any external-email send for missing-contact rows", () => {
    // No new Resend or send-outreach call paths were added in this patch;
    // the outreach block gate still throws before any send pipeline.
    const blockedSendIdx = EDGE.indexOf("pending_engagement.outreach_blocked_missing_email");
    expect(blockedSendIdx).toBeGreaterThan(0);
    // The new emit lives in the gate path that throws an ApiException right
    // after, so it cannot fall through to send code.
    const after = EDGE.slice(blockedSendIdx, blockedSendIdx + 2000);
    expect(after).toMatch(/throw new ApiException/);
  });
});
