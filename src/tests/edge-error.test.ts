/**
 * Unit tests for parseEdgeError — locks the contract that
 * supabase.functions.invoke() failures surface a stable
 * { status, code, message } shape, with friendly copy for
 * known codes (MFA_REQUIRED, REFUND_ALREADY_PENDING, etc.).
 *
 * Regression guard for Daniel's UAT failures where MFA_REQUIRED
 * and duplicate-refund errors collapsed to "Edge Function
 * returned a non-2xx status code".
 */
import { describe, it, expect } from "vitest";
import { parseEdgeError } from "@/lib/edge-error";

function fakeError(status: number, body: unknown) {
  const ctx = new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
  const err = new Error("Edge Function returned a non-2xx status code") as Error & {
    context?: Response;
  };
  err.context = ctx;
  return err;
}

describe("parseEdgeError", () => {
  it("maps MFA_REQUIRED to the friendly enrol-MFA copy", async () => {
    const parsed = await parseEdgeError(
      fakeError(403, { code: "MFA_REQUIRED", message: "raw backend msg" }),
    );
    expect(parsed.status).toBe(403);
    expect(parsed.code).toBe("MFA_REQUIRED");
    expect(parsed.message).toMatch(/multi-factor authentication/i);
    expect(parsed.message).toMatch(/enrol an authenticator/i);
  });

  it("maps REFUND_ALREADY_PENDING to the duplicate-pending copy", async () => {
    const parsed = await parseEdgeError(
      fakeError(409, { code: "REFUND_ALREADY_PENDING" }),
    );
    expect(parsed.code).toBe("REFUND_ALREADY_PENDING");
    expect(parsed.message).toMatch(/already pending/i);
  });

  it("maps NOT_PLATFORM_ADMIN to the platform-admin copy", async () => {
    const parsed = await parseEdgeError(
      fakeError(403, { code: "NOT_PLATFORM_ADMIN" }),
    );
    expect(parsed.code).toBe("NOT_PLATFORM_ADMIN");
    expect(parsed.message).toMatch(/platform administrator/i);
  });

  it("falls back to backend message for unknown codes", async () => {
    const parsed = await parseEdgeError(
      fakeError(422, { code: "SOMETHING_NEW", message: "specific backend explanation" }),
    );
    expect(parsed.code).toBe("SOMETHING_NEW");
    expect(parsed.message).toBe("specific backend explanation");
  });

  it("falls back to error.message when no context body is parseable", async () => {
    const err = new Error("network down");
    const parsed = await parseEdgeError(err);
    expect(parsed.status).toBeNull();
    expect(parsed.code).toBeNull();
    expect(parsed.message).toBe("network down");
  });

  it("surfaces 'Unexpected error' for non-Error rejections", async () => {
    const parsed = await parseEdgeError({ weird: true });
    expect(parsed.message).toBe("Unexpected error");
  });

  it("prefers body.error when body.message is absent", async () => {
    const parsed = await parseEdgeError(
      fakeError(400, { error: "missing field xyz" }),
    );
    expect(parsed.message).toBe("missing field xyz");
  });
});
