/**
 * DATA-010 Phase 1 — `redactExportMetadata` is the single allowlist
 * helper every CSV/JSON export must run row metadata through before
 * it leaves the browser. This pins the redaction contract so future
 * changes to download-utils don't silently leak IPs, user agents,
 * tokens, secrets, or webhook signatures.
 */
import { describe, it, expect } from "vitest";

import { redactExportMetadata } from "@/lib/download-utils";

describe("DATA-010 — redactExportMetadata strips PII / secrets / internal context", () => {
  it("redacts IP / user-agent / request-id and similar internal fields", () => {
    const out = redactExportMetadata({
      actor_ip: "1.2.3.4",
      ip_address: "5.6.7.8",
      user_agent: "Mozilla/5.0",
      request_id: "abc-123",
      session_id: "sess-xyz",
      payment_reference: "ref-001",
      benign_field: "keep-me",
    }) as Record<string, string>;
    expect(out.actor_ip).toBe("[redacted]");
    expect(out.ip_address).toBe("[redacted]");
    expect(out.user_agent).toBe("[redacted]");
    expect(out.request_id).toBe("[redacted]");
    expect(out.session_id).toBe("[redacted]");
    expect(out.payment_reference).toBe("[redacted]");
    expect(out.benign_field).toBe("keep-me");
  });

  it("redacts any key ending with _token, _secret, _key, _password, _hash", () => {
    const out = redactExportMetadata({
      refresh_token: "rt",
      paystack_secret: "s",
      service_role_key: "srk",
      admin_password: "pw",
      filters_hash: "fh",
      keep: 1,
    }) as Record<string, unknown>;
    expect(out.refresh_token).toBe("[redacted]");
    expect(out.paystack_secret).toBe("[redacted]");
    expect(out.service_role_key).toBe("[redacted]");
    expect(out.admin_password).toBe("[redacted]");
    expect(out.filters_hash).toBe("[redacted]");
    expect(out.keep).toBe(1);
  });

  it("redacts recursively inside nested objects and arrays", () => {
    const out = redactExportMetadata({
      outer: {
        ok: "ok",
        bearer: "leaked-token",
        nested: [{ webhook_signature: "sig", label: "fine" }],
      },
    }) as { outer: { bearer: string; nested: Array<Record<string, string>> } };
    expect(out.outer.bearer).toBe("[redacted]");
    expect(out.outer.nested[0].webhook_signature).toBe("[redacted]");
    expect(out.outer.nested[0].label).toBe("fine");
  });

  it("passes primitives and nulls through unchanged", () => {
    expect(redactExportMetadata("hello")).toBe("hello");
    expect(redactExportMetadata(42)).toBe(42);
    expect(redactExportMetadata(null)).toBe(null);
    expect(redactExportMetadata(undefined)).toBe(undefined);
  });
});
