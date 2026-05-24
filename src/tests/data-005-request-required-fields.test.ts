/**
 * DATA-005 Phase 1 — request body validation contract.
 *
 * Mirrors the Zod schema on supabase/functions/user-export-request/index.ts.
 * If the edge schema changes, this test must be updated in lockstep.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ALLOWED_USER_EXPORT_CATEGORIES } from "@/lib/user-export-categories";

const BodySchema = z.object({
  categories: z.array(z.string().trim().min(1).max(64)).min(1).max(32),
  reason: z.string().trim().max(500).optional(),
}).strict();

describe("DATA-005 — request body required fields", () => {
  it("rejects empty categories array", () => {
    const r = BodySchema.safeParse({ categories: [] });
    expect(r.success).toBe(false);
  });

  it("rejects missing categories", () => {
    const r = BodySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it("rejects category list larger than 32 entries", () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => `cat_${i}`);
    const r = BodySchema.safeParse({ categories: tooMany });
    expect(r.success).toBe(false);
  });

  it("rejects unknown reason fields (strict)", () => {
    const r = BodySchema.safeParse({
      categories: ["profile"],
      malicious_extra_field: true,
    });
    expect(r.success).toBe(false);
  });

  it("accepts a single valid allowed category", () => {
    const r = BodySchema.safeParse({ categories: ["profile"] });
    expect(r.success).toBe(true);
  });

  it("accepts the full allowed-categories list", () => {
    const r = BodySchema.safeParse({
      categories: [...ALLOWED_USER_EXPORT_CATEGORIES],
    });
    expect(r.success).toBe(true);
  });

  it("accepts an unknown category at the schema layer (scope resolver strips it later)", () => {
    // The Zod schema only enforces shape — semantic filtering of
    // forbidden/unknown categories is done by resolveExportScope.
    const r = BodySchema.safeParse({ categories: ["passwords"] });
    expect(r.success).toBe(true);
  });
});
