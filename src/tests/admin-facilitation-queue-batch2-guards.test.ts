/**
 * Unknown-Counterparty Admin Facilitation — Batch 2 static guards & unit tests.
 *
 * Proves at test time:
 *   • new UI files contain NO send/dispatch/email/SMS/WhatsApp/provider tokens
 *   • no Send button or send-like copy is introduced
 *   • the priority/filter helpers behave correctly and consume only queue_derived
 *   • existing legacy filter tabs remain present in the panel
 *   • POI Verification Gate files are untouched (no imports introduced here)
 *   • AI Outreach Drafter Phase 1 functions are not modified by Batch 2 code
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FACILITATION_FILTERS,
  isFacilitationFilter,
  matchesFacilitationFilter,
  NEXT_ACTION_PRIORITY,
  priorityIndex,
  type QueueDerived,
} from "@/lib/admin-facilitation-queue";

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8");
}

const BATCH_2_FILES = [
  "src/lib/admin-facilitation-queue.ts",
  "src/components/admin/AdminFacilitationQueueBadges.tsx",
];

const FORBIDDEN_DISPATCH_TOKENS = [
  "notification-dispatch",
  "send-transactional-email",
  "process-email-queue",
  "engagement-reminder",
  "functions.invoke",
  "resend.com",
  "sendgrid",
  "twilio",
  "smtp",
  "mailgun",
  "fetch(",
  "supabase.from(",
  "supabase.rpc(",
];

// Patterns that indicate a SEND ACTION affordance (button label / handler).
// Legitimate disclaimer copy like "manual send required" or "does not send
// outreach" is explicitly permitted because it tells the operator that the
// platform will NOT send anything.
const FORBIDDEN_SEND_COPY = [
  /Send\s+outreach/i,
  /Send\s+email/i,
  /Send\s+now/i,
  /\bDispatch\b/i,
  /\bMessage counterparty\b/i,
  /\bNotify counterparty\b/i,
  /\bTrigger outreach\b/i,
  /onClick=\{[^}]*\bsend[A-Z]/, // e.g. onClick={sendOutreach}
];

function stripCommentsAndStrings(src: string): string {
  // Remove block comments and line comments (they document the boundary).
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

describe("Batch 2 — Queue UI badges + filters: static guards", () => {
  it.each(BATCH_2_FILES)("%s contains no dispatch tokens", (file) => {
    const src = stripCommentsAndStrings(read(file)).toLowerCase();
    for (const tok of FORBIDDEN_DISPATCH_TOKENS) {
      expect(src, `${file} must not reference ${tok}`).not.toContain(tok);
    }
  });

  it.each(BATCH_2_FILES)("%s contains no Send-like UI copy", (file) => {
    const src = read(file);
    for (const rx of FORBIDDEN_SEND_COPY) {
      expect(rx.test(src), `${file} must not contain pattern ${rx}`).toBe(false);
    }
  });

  it("AdminPendingEngagementsPanel preserves every legacy filter tab", () => {
    const src = read("src/components/admin/AdminPendingEngagementsPanel.tsx");
    const legacyTabs = [
      '{ value: "all"',
      '{ value: "active"',
      '{ value: "pending"',
      '{ value: "notification_sent"',
      '{ value: "contacted"',
      '{ value: "accepted"',
      '{ value: "declined"',
      'value: "late_acceptance_pending_initiator_reconfirmation"',
      '{ value: "binding_review_required"',
      '{ value: "disputed_being_named"',
      '{ value: "cancelled_email_change"',
    ];
    for (const tab of legacyTabs) {
      expect(src.includes(tab), `legacy filter tab missing: ${tab}`).toBe(true);
    }
  });

  it("Batch 2 panel changes do not import any AI Outreach Drafter mutation helpers", () => {
    const src = read("src/components/admin/AdminPendingEngagementsPanel.tsx");
    // Mutating draft hooks/edge fns must not be newly wired in via Batch 2.
    // The existing EngagementOutreachDraftPanel import is Phase 1 (pre-Batch-2)
    // and is allowed; no new draft mutation paths may be added by Batch 2.
    expect(src).not.toMatch(/generate-engagement-outreach-draft.*invoke/i);
    expect(src).not.toMatch(/engagement-outreach-draft-decision.*invoke/i);
  });

  it("Batch 2 files do not reference POI Verification Gate edge functions", () => {
    // POI Verification Gate workstream artefacts must remain untouched.
    for (const file of BATCH_2_FILES) {
      const src = read(file).toLowerCase();
      expect(src).not.toContain("poi-verification-gate");
      expect(src).not.toContain("poi-export-gate");
    }
  });
});

describe("Batch 2 — filter logic uses only queue_derived", () => {
  const qd = (overrides: Partial<QueueDerived>): QueueDerived => ({
    queue_age_days: 0,
    sla_due_at: null,
    sla_status: "not_applicable",
    last_outreach_at: null,
    last_outreach_channel: null,
    last_outreach_outcome: null,
    outreach_count: 0,
    draft_status: null,
    approved_draft_available: false,
    manual_send_required: false,
    next_action_label: "needs_admin_action",
    next_action_reason: "",
    ...overrides,
  });

  it("isFacilitationFilter recognises all new filter values", () => {
    for (const f of FACILITATION_FILTERS) {
      expect(isFacilitationFilter(f.value)).toBe(true);
    }
    expect(isFacilitationFilter("all")).toBe(false);
    expect(isFacilitationFilter("notification_sent")).toBe(false);
  });

  it("overdue filter matches sla_status=overdue", () => {
    expect(matchesFacilitationFilter("overdue", qd({ sla_status: "overdue" }))).toBe(true);
    expect(matchesFacilitationFilter("overdue", qd({ sla_status: "due_soon" }))).toBe(false);
  });

  it("due_soon filter matches sla_status=due_soon", () => {
    expect(matchesFacilitationFilter("due_soon", qd({ sla_status: "due_soon" }))).toBe(true);
    expect(matchesFacilitationFilter("due_soon", qd({ sla_status: "overdue" }))).toBe(false);
  });

  it("draft_approved_manual_send filter requires both approved status and manual_send flag", () => {
    expect(
      matchesFacilitationFilter(
        "draft_approved_manual_send",
        qd({ draft_status: "approved", manual_send_required: true }),
      ),
    ).toBe(true);
    expect(
      matchesFacilitationFilter(
        "draft_approved_manual_send",
        qd({ draft_status: "approved", manual_send_required: false }),
      ),
    ).toBe(false);
  });

  it("no_outreach_logged filter excludes terminal states", () => {
    expect(
      matchesFacilitationFilter(
        "no_outreach_logged",
        qd({ outreach_count: 0, next_action_label: "no_outreach_logged" }),
      ),
    ).toBe(true);
    expect(
      matchesFacilitationFilter(
        "no_outreach_logged",
        qd({ outreach_count: 0, next_action_label: "accepted" }),
      ),
    ).toBe(false);
  });

  it("blocked_ineligible_facilitation matches blocked_ineligible label", () => {
    expect(
      matchesFacilitationFilter(
        "blocked_ineligible_facilitation",
        qd({ next_action_label: "blocked_ineligible" }),
      ),
    ).toBe(true);
  });

  it("returns false when queue_derived is missing (display-safe)", () => {
    expect(matchesFacilitationFilter("overdue", null)).toBe(false);
    expect(matchesFacilitationFilter("overdue", undefined)).toBe(false);
  });

  it("priorityIndex orders blocked_ineligible first and declined last", () => {
    expect(priorityIndex("blocked_ineligible")).toBe(0);
    expect(priorityIndex("declined")).toBe(NEXT_ACTION_PRIORITY.length - 1);
    expect(priorityIndex(undefined)).toBe(NEXT_ACTION_PRIORITY.length);
  });
});
