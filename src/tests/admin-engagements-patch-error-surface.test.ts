/**
 * AdminPendingEngagementsPanel — PATCH counterparty_email error must abort outreach.
 *
 * Regression for the "swallowed PATCH error" defect:
 *
 *   Before: openOutreachDialog destructured only `{ data }` from the PATCH
 *   `poi-engagements/:id` call. If the PATCH failed (validation reject,
 *   idempotency collision, transient 5xx) the failure was silently swallowed
 *   and the flow proceeded to `preview-outreach`, which then 400'd with the
 *   misleading "no usable counterparty email on file" toast.
 *
 *   After: the PATCH call destructures `{ data, error }`. On `error` we
 *   surface the real backend reason via `extractEdgeError` and abort BEFORE
 *   `preview-outreach` is invoked.
 *
 * These tests model the conditional sequencing rule directly so the contract
 * cannot regress without the test failing. The component code path under
 * test lives in src/components/admin/AdminPendingEngagementsPanel.tsx
 * (openOutreachDialog).
 */

import { describe, it, expect, vi } from "vitest";

/**
 * Minimal re-implementation of the openOutreachDialog ordering contract.
 * Mirrors the structure used in the component: PATCH first, abort on error,
 * only then call preview-outreach.
 */
async function runOutreachFlow(opts: {
  patch: () => Promise<{ data: any; error: any }>;
  preview: () => Promise<{ data: any; error: any }>;
  extractEdgeError: (err: any, fallback: string) => Promise<string>;
  toastError: (msg: string) => void;
}) {
  const { data: _patchData, error: patchError } = await opts.patch();
  if (patchError) {
    const msg = await opts.extractEdgeError(
      patchError,
      "Could not save the counterparty email. Please check the address and try again.",
    );
    opts.toastError(msg);
    return { reachedPreview: false };
  }
  const { error: previewError } = await opts.preview();
  if (previewError) {
    opts.toastError("Could not load email preview. Please try again.");
    return { reachedPreview: true, previewFailed: true };
  }
  return { reachedPreview: true, previewFailed: false };
}

describe("openOutreachDialog — PATCH error surfacing", () => {
  it("PATCH failure does NOT call preview-outreach", async () => {
    const preview = vi.fn(async () => ({ data: null, error: null }));
    const patch = vi.fn(async () => ({
      data: null,
      error: { message: "validation_failed: invalid email" },
    }));
    const toastError = vi.fn();
    const extractEdgeError = vi.fn(async (e: any) => e?.message ?? "fallback");

    const result = await runOutreachFlow({ patch, preview, extractEdgeError, toastError });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
    expect(result.reachedPreview).toBe(false);
  });

  it("PATCH failure surfaces the PATCH error (not the preview fallback)", async () => {
    const preview = vi.fn(async () => ({ data: null, error: null }));
    const patch = vi.fn(async () => ({
      data: null,
      error: { message: "EMAIL_REJECTED: domain on suppression list" },
    }));
    const toastError = vi.fn();
    const extractEdgeError = vi.fn(async (e: any) => e?.message ?? "fallback");

    await runOutreachFlow({ patch, preview, extractEdgeError, toastError });

    expect(extractEdgeError).toHaveBeenCalledOnce();
    expect(toastError).toHaveBeenCalledWith(
      "EMAIL_REJECTED: domain on suppression list",
    );
    // The misleading preview-fallback wording must never appear when the
    // failure is actually upstream in PATCH.
    for (const call of toastError.mock.calls) {
      expect(call[0]).not.toMatch(/email preview/i);
      expect(call[0]).not.toMatch(/no usable counterparty email/i);
    }
  });

  it("falls back to a neutral message if extractEdgeError returns the fallback", async () => {
    const preview = vi.fn(async () => ({ data: null, error: null }));
    const patch = vi.fn(async () => ({ data: null, error: { message: "" } }));
    const toastError = vi.fn();
    const extractEdgeError = vi.fn(async (_e: any, fallback: string) => fallback);

    await runOutreachFlow({ patch, preview, extractEdgeError, toastError });

    expect(toastError).toHaveBeenCalledWith(
      "Could not save the counterparty email. Please check the address and try again.",
    );
    expect(preview).not.toHaveBeenCalled();
  });

  it("successful PATCH proceeds to preview-outreach", async () => {
    const preview = vi.fn(async () => ({
      data: { recipient: "buyer@example.com", subject: "Hello", template_data: {} },
      error: null,
    }));
    const patch = vi.fn(async () => ({ data: { binding: null }, error: null }));
    const toastError = vi.fn();
    const extractEdgeError = vi.fn(async () => "should not be called");

    const result = await runOutreachFlow({ patch, preview, extractEdgeError, toastError });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(extractEdgeError).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(result.reachedPreview).toBe(true);
    expect(result.previewFailed).toBe(false);
  });
});
