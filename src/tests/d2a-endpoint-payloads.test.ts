/**
 * D2a — endpoint payload schema tests.
 *
 * Mirrors the Zod schemas defined inline in
 * `supabase/functions/poi-engagements/index.ts` for the new
 * /:id/dispute and /:id/cancel-for-email-change endpoints, so the
 * accept/reject contract is pinned by Vitest without requiring a live
 * Deno harness. Keep in lockstep with the edge-function definitions.
 *
 * NOT YET COVERED HERE (D2a live-harness items):
 *   • End-to-end POST flow against the deployed edge function.
 *   • PATCH email-change refusal (depends on an existing engagement +
 *     outreach log row in the live DB).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

const DisputeSchema = z
  .object({
    reason: z.string().trim().min(10).max(1000),
    dispute_source: z.enum(["counterparty_token", "admin_report"]),
    token_hash: z.string().trim().min(1).max(256).optional().nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.dispute_source === "counterparty_token") {
      if (!val.token_hash || val.token_hash.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["token_hash"],
          message:
            "token_hash is required when dispute_source='counterparty_token'",
        });
      }
    }
  });

const CancelSchema = z.object({
  new_email: z.string().trim().toLowerCase().min(3).max(254).email(),
  reason: z.string().trim().max(1000).optional(),
});

describe("D2a — POST /poi-engagements/:id/dispute payload", () => {
  it("admin_report dispute without token_hash succeeds", () => {
    const r = DisputeSchema.safeParse({
      reason: "Counterparty phoned us to deny involvement.",
      dispute_source: "admin_report",
    });
    expect(r.success).toBe(true);
  });

  it("counterparty_token dispute without token_hash fails", () => {
    const r = DisputeSchema.safeParse({
      reason: "Counterparty clicked the dispute link.",
      dispute_source: "counterparty_token",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const fields = r.error.flatten().fieldErrors;
      expect(fields.token_hash).toBeDefined();
    }
  });

  it("counterparty_token dispute with token_hash succeeds", () => {
    const r = DisputeSchema.safeParse({
      reason: "Counterparty clicked the dispute link from the email.",
      dispute_source: "counterparty_token",
      token_hash: "deadbeef".repeat(8),
    });
    expect(r.success).toBe(true);
  });

  it("rejects reason shorter than 10 characters", () => {
    const r = DisputeSchema.safeParse({
      reason: "short",
      dispute_source: "admin_report",
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown dispute_source", () => {
    const r = DisputeSchema.safeParse({
      reason: "Some long-enough reason text.",
      dispute_source: "made_up_source",
    });
    expect(r.success).toBe(false);
  });
});

describe("D2a — POST /poi-engagements/:id/cancel-for-email-change payload", () => {
  it("accepts a well-formed payload (email + optional reason)", () => {
    const r = CancelSchema.safeParse({
      new_email: "  Counterparty@Example.com  ",
      reason: "Bounce on previous address",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.new_email).toBe("counterparty@example.com");
    }
  });

  it("accepts payload with only new_email", () => {
    const r = CancelSchema.safeParse({ new_email: "ok@example.com" });
    expect(r.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const r = CancelSchema.safeParse({ new_email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("rejects missing new_email", () => {
    const r = CancelSchema.safeParse({ reason: "x" });
    expect(r.success).toBe(false);
  });
});
