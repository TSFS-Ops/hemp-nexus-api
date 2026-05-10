/**
 * D3 — Admin Pending Engagement Operations UI: schema + helper unit tests.
 *
 * Pure-schema/helper tests (no React render, no live DB). They pin:
 *   • disputeEngagementSchema — token_hash required only when
 *     dispute_source='counterparty_token', reason 10–1000 chars.
 *   • cancelForEmailChangeSchema — valid email required, rejects .invalid TLD.
 *   • pickAdminEngagementBlockedReason — produces the right "what to do next"
 *     hint for binding-review, dispute, cancelled-email-change, late-acceptance,
 *     and contact-incomplete rows.
 *   • humaniseEngagementError — maps EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE
 *     to admin-readable copy that points at the cancel-and-recreate flow.
 *
 * D2a/D2b live-proof harnesses already cover the server contract end-to-end
 * (supabase/functions/d2a-live-proof, supabase/functions/d2b-live-proof);
 * D3 is pure UI wiring on top of those proven endpoints.
 */

import { describe, it, expect } from "vitest";
import { disputeEngagementSchema } from "@/components/admin/DisputeEngagementDialog";
import { cancelForEmailChangeSchema } from "@/components/admin/CancelForEmailChangeDialog";
import {
  ADMIN_ENGAGEMENT_BLOCKED_COPY,
  pickAdminEngagementBlockedReason,
} from "@/lib/admin-engagement-blocked-reasons";
import { humaniseEngagementError } from "@/lib/humanise-engagement-error";

describe("D3 — disputeEngagementSchema", () => {
  const validReason = "Spoke to ops on +27 11 555 0100; they confirm not party to the trade.";

  it("admin_report accepts payload without token_hash", () => {
    const r = disputeEngagementSchema.safeParse({
      reason: validReason,
      dispute_source: "admin_report",
    });
    expect(r.success).toBe(true);
  });

  it("admin_report ignores empty token_hash string", () => {
    const r = disputeEngagementSchema.safeParse({
      reason: validReason,
      dispute_source: "admin_report",
      token_hash: "",
    });
    expect(r.success).toBe(true);
  });

  it("counterparty_token requires non-empty token_hash", () => {
    const r = disputeEngagementSchema.safeParse({
      reason: validReason,
      dispute_source: "counterparty_token",
    });
    expect(r.success).toBe(false);
  });

  it("counterparty_token accepts valid token_hash", () => {
    const r = disputeEngagementSchema.safeParse({
      reason: validReason,
      dispute_source: "counterparty_token",
      token_hash: "a".repeat(64),
    });
    expect(r.success).toBe(true);
  });

  it("rejects reason shorter than 10 chars", () => {
    const r = disputeEngagementSchema.safeParse({
      reason: "too short",
      dispute_source: "admin_report",
    });
    expect(r.success).toBe(false);
  });

  it("rejects reason longer than 1000 chars", () => {
    const r = disputeEngagementSchema.safeParse({
      reason: "x".repeat(1001),
      dispute_source: "admin_report",
    });
    expect(r.success).toBe(false);
  });
});

describe("D3 — cancelForEmailChangeSchema", () => {
  it("accepts a valid email and optional reason", () => {
    const r = cancelForEmailChangeSchema.safeParse({
      new_email: "Ops@Counterparty.example.com",
      reason: "Confirmed correction by phone.",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      // toLowerCase is part of the schema so audit logs see canonical form.
      expect(r.data.new_email).toBe("ops@counterparty.example.com");
    }
  });

  it("rejects malformed email", () => {
    const r = cancelForEmailChangeSchema.safeParse({ new_email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects RFC 2606 .invalid TLD placeholders", () => {
    const r = cancelForEmailChangeSchema.safeParse({
      new_email: "anyone@example.invalid",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty reason longer than 1000 chars", () => {
    const r = cancelForEmailChangeSchema.safeParse({
      new_email: "ops@valid.com",
      reason: "x".repeat(1001),
    });
    expect(r.success).toBe(false);
  });
});

describe("D3 — pickAdminEngagementBlockedReason", () => {
  it("returns null for clean rows", () => {
    expect(
      pickAdminEngagementBlockedReason({
        engagement_status: "notification_sent",
        contact_blocked: false,
      }),
    ).toBeNull();
  });

  it("prioritises binding_review_required over everything else", () => {
    expect(
      pickAdminEngagementBlockedReason({
        operational_state: "binding_review_required",
        engagement_status: "disputed_being_named",
        contact_blocked: true,
      }),
    ).toBe("binding_review_required");
  });

  it("ignores binding_review when binding_resolution is set", () => {
    expect(
      pickAdminEngagementBlockedReason({
        operational_state: "binding_review_required",
        binding_resolution: "confirmed_canonical",
        engagement_status: "notification_sent",
      }),
    ).toBeNull();
  });

  it("identifies disputed_being_named", () => {
    expect(
      pickAdminEngagementBlockedReason({
        engagement_status: "disputed_being_named",
      }),
    ).toBe("disputed_being_named");
  });

  it("identifies cancelled_email_change", () => {
    expect(
      pickAdminEngagementBlockedReason({
        engagement_status: "cancelled_email_change",
      }),
    ).toBe("cancelled_email_change");
  });

  it("identifies late_acceptance_pending_initiator_reconfirmation", () => {
    expect(
      pickAdminEngagementBlockedReason({
        engagement_status: "late_acceptance_pending_initiator_reconfirmation",
      }),
    ).toBe("late_acceptance_pending_initiator_reconfirmation");
  });

  it("falls back to contact_incomplete when contact_blocked", () => {
    expect(
      pickAdminEngagementBlockedReason({
        engagement_status: "notification_sent",
        contact_blocked: true,
      }),
    ).toBe("contact_incomplete");
  });

  it("provides a `next` action sentence for every reason", () => {
    for (const reason of Object.keys(ADMIN_ENGAGEMENT_BLOCKED_COPY)) {
      const copy =
        ADMIN_ENGAGEMENT_BLOCKED_COPY[
          reason as keyof typeof ADMIN_ENGAGEMENT_BLOCKED_COPY
        ];
      expect(copy.next.length).toBeGreaterThan(0);
      expect(copy.label.length).toBeGreaterThan(0);
    }
  });
});

describe("D3 — humaniseEngagementError mapping for EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE", () => {
  it("maps the raw server code to admin-readable copy", () => {
    const h = humaniseEngagementError({
      message: "EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE",
    });
    expect(h.headline).toMatch(/email cannot be edited/i);
    expect(h.hint).toMatch(/cancel for email change/i);
    expect(h.technical).toContain("EMAIL_CHANGE_REQUIRES_CANCEL_RECREATE");
  });
});
