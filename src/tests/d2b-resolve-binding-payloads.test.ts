/**
 * D2b — POST /poi-engagements/:id/resolve-binding payload schema tests.
 *
 * Mirrors the Zod schema defined inline in
 * `supabase/functions/poi-engagements/index.ts` (`ResolveSchema`).
 * Keep in lockstep with the edge-function definition.
 *
 * NOT covered here (live-harness items):
 *   • End-to-end POST flow against the deployed edge function.
 *   • State-machine guard (engagement-must-be-in-binding-review),
 *     audit log writes, and the CHECK constraints — exercised by
 *     supabase/functions/d2b-live-proof/index.ts.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";

const ResolveSchema = z
  .object({
    resolution: z.enum([
      "confirmed_canonical",
      "rejected",
      "deferred_no_review_needed",
    ]),
    selected_org_id: z.string().uuid().optional().nullable(),
    notes: z.string().trim().min(20).max(1000),
  })
  .superRefine((val, ctx) => {
    if (val.resolution === "confirmed_canonical") {
      if (!val.selected_org_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["selected_org_id"],
          message:
            "selected_org_id is required when resolution='confirmed_canonical'",
        });
      }
    } else if (val.selected_org_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selected_org_id"],
        message:
          "selected_org_id must be omitted unless resolution='confirmed_canonical'",
      });
    }
  });

const ORG_ID = "11111111-2222-3333-4444-555555555555";
const VALID_NOTES = "Reviewed candidates and confirmed canonical org.";

describe("D2b — resolve-binding payload validation", () => {
  it("confirmed_canonical with selected_org_id + notes succeeds", () => {
    const r = ResolveSchema.safeParse({
      resolution: "confirmed_canonical",
      selected_org_id: ORG_ID,
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(true);
  });

  it("confirmed_canonical without selected_org_id fails", () => {
    const r = ResolveSchema.safeParse({
      resolution: "confirmed_canonical",
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.selected_org_id).toBeDefined();
    }
  });

  it("rejected without selected_org_id succeeds", () => {
    const r = ResolveSchema.safeParse({
      resolution: "rejected",
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(true);
  });

  it("rejected WITH selected_org_id fails", () => {
    const r = ResolveSchema.safeParse({
      resolution: "rejected",
      selected_org_id: ORG_ID,
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.selected_org_id).toBeDefined();
    }
  });

  it("deferred_no_review_needed without selected_org_id succeeds", () => {
    const r = ResolveSchema.safeParse({
      resolution: "deferred_no_review_needed",
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(true);
  });

  it("deferred_no_review_needed WITH selected_org_id fails", () => {
    const r = ResolveSchema.safeParse({
      resolution: "deferred_no_review_needed",
      selected_org_id: ORG_ID,
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(false);
  });

  it("notes shorter than 20 chars is rejected", () => {
    const r = ResolveSchema.safeParse({
      resolution: "rejected",
      notes: "too short",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.notes).toBeDefined();
    }
  });

  it("notes longer than 1000 chars is rejected", () => {
    const r = ResolveSchema.safeParse({
      resolution: "rejected",
      notes: "a".repeat(1001),
    });
    expect(r.success).toBe(false);
  });

  it("unknown resolution value is rejected", () => {
    const r = ResolveSchema.safeParse({
      resolution: "something_else",
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(false);
  });

  it("selected_org_id must be a UUID when present", () => {
    const r = ResolveSchema.safeParse({
      resolution: "confirmed_canonical",
      selected_org_id: "not-a-uuid",
      notes: VALID_NOTES,
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.flatten().fieldErrors.selected_org_id).toBeDefined();
    }
  });
});
