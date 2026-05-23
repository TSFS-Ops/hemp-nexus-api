/**
 * DATA-010 Phase 1 — purpose & reason are required at the client helper
 * boundary. The `recordExportAudit` helper MUST throw
 * `ExportAuditValidationError` before any network call when:
 *   - `purpose` is empty / missing
 *   - `reason` is missing, whitespace-only, or shorter than 10 chars
 *
 * The server (supabase/functions/export-audit/index.ts) re-validates the
 * same constraint via its Zod schema, but the client guard prevents an
 * unaudited download from ever being attempted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: vi.fn(async () => ({ data: { ok: true }, error: null })),
    },
  },
}));

import {
  recordExportAudit,
  ExportAuditValidationError,
} from "@/lib/export-audit";
import { supabase } from "@/integrations/supabase/client";
import { MIN_EXPORT_REASON_LENGTH } from "@/lib/export-purpose";

describe("DATA-010 — recordExportAudit purpose/reason validation", () => {
  beforeEach(() => {
    (supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("throws when purpose is missing", async () => {
    await expect(
      recordExportAudit({
        target_type: "audit_logs",
        row_count: 1,
        purpose: undefined as unknown as "audit_or_regulatory_review",
        reason: "valid reason text here",
      }),
    ).rejects.toBeInstanceOf(ExportAuditValidationError);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("throws when reason is missing", async () => {
    await expect(
      recordExportAudit({
        target_type: "audit_logs",
        row_count: 1,
        purpose: "audit_or_regulatory_review",
        reason: undefined as unknown as string,
      }),
    ).rejects.toBeInstanceOf(ExportAuditValidationError);
  });

  it(`throws when reason is shorter than ${MIN_EXPORT_REASON_LENGTH} chars (trimmed)`, async () => {
    await expect(
      recordExportAudit({
        target_type: "audit_logs",
        row_count: 1,
        purpose: "audit_or_regulatory_review",
        reason: "   short    ",
      }),
    ).rejects.toBeInstanceOf(ExportAuditValidationError);
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("invokes the edge function when purpose + reason are valid", async () => {
    const result = await recordExportAudit({
      target_type: "audit_logs",
      row_count: 1,
      purpose: "audit_or_regulatory_review",
      reason: "valid reason text for testing",
    });
    expect(result.ok).toBe(true);
    expect(supabase.functions.invoke).toHaveBeenCalledWith(
      "export-audit",
      expect.objectContaining({
        body: expect.objectContaining({
          purpose: "audit_or_regulatory_review",
          reason: "valid reason text for testing",
        }),
      }),
    );
  });

  it("surfaces aal_required when the server returns MFA_REQUIRED", async () => {
    (supabase.functions.invoke as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null,
      error: { message: "mfa_required", context: { status: 403 } },
    });
    const result = await recordExportAudit({
      target_type: "audit_logs",
      row_count: 1,
      purpose: "audit_or_regulatory_review",
      reason: "valid reason text for testing",
    });
    expect(result.ok).toBe(false);
    expect(result.aal_required).toBe(true);
  });
});
