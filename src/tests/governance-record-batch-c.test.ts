/**
 * governance-record-batch-c.test.ts — client mirror of the Batch C reason-code
 * namespace allow-list. The canonical writer lives in the edge runtime and
 * mutates the reason_code in place; this file proves the UI-side helper
 * agrees on which codes are KNOWN (so legacy/system/payment codes don't get
 * misrendered as "outside approved list" once they flow back to the UI).
 */

import { describe, it, expect } from "vitest";
import {
  APPROVED_REASON_CODES,
  APPROVED_REASON_CODE_NAMESPACES,
  isApprovedReasonCode,
} from "@/lib/governance/governance-record";

describe("APPROVED_REASON_CODE_NAMESPACES (client mirror)", () => {
  it("matches the backend set of six prefixes", () => {
    expect([...APPROVED_REASON_CODE_NAMESPACES].sort()).toEqual([
      "action",
      "api",
      "legacy",
      "payment",
      "scope",
      "system",
    ]);
  });
});

describe("isApprovedReasonCode (client)", () => {
  it("accepts null/undefined as approved (reason_code is optional)", () => {
    expect(isApprovedReasonCode(null)).toBe(true);
    expect(isApprovedReasonCode(undefined)).toBe(true);
  });

  it("accepts every David-approved business code", () => {
    for (const code of APPROVED_REASON_CODES) {
      expect(isApprovedReasonCode(code)).toBe(true);
    }
  });

  it("accepts approved namespaces with dynamic suffixes", () => {
    for (const code of [
      "system:collapse_ok",
      "system:token_burn_rpc_error",
      "payment:charge_success",
      "payment:refund_partial_manual_review",
      "api:my-endpoint",
      "action:credit_burn",
      "scope:org",
      "legacy:anything",
    ]) {
      expect(isApprovedReasonCode(code)).toBe(true);
    }
  });

  it("rejects unknown unnamespaced codes", () => {
    expect(isApprovedReasonCode("totally_made_up")).toBe(false);
  });

  it("rejects disallowed namespaces", () => {
    expect(isApprovedReasonCode("random:foo")).toBe(false);
    expect(isApprovedReasonCode("doc:something")).toBe(false);
  });

  it("keeps document-specific codes excluded (separate AI/doc scope)", () => {
    for (const code of [
      "missing_required_document",
      "document_expired",
      "document_rejected",
      "document_review_completed",
    ]) {
      expect(isApprovedReasonCode(code)).toBe(false);
    }
  });
});
