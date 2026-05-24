/**
 * CP-003 seed audit-parity pin.
 *
 * The CP-003 seed must idempotently emit all three audit names so dashboards
 * keyed on either the legacy alias OR the signed canonical name see the
 * fixture. Mirrors the prebuild guard at scripts/check-cp003-audit-names.mjs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SEED = readFileSync(
  resolve(__dirname, "../../supabase/functions/seed-cp003-controlled-prod/index.ts"),
  "utf8",
);

describe("CP-003 seed emits both signed canonical names and the legacy sibling", () => {
  it("emits pending_engagement.identity_incomplete_email_only_detected", () => {
    expect(SEED).toContain('"pending_engagement.identity_incomplete_email_only_detected"');
  });
  it("emits pending_engagement.outreach_blocked_missing_name (legacy sibling)", () => {
    expect(SEED).toContain('"pending_engagement.outreach_blocked_missing_name"');
  });
  it("emits pending_engagement.outreach_blocked_missing_counterparty_name (signed canonical)", () => {
    expect(SEED).toContain('"pending_engagement.outreach_blocked_missing_counterparty_name"');
  });
  it("seed inserts the signed sibling idempotently (priorSigned guard present)", () => {
    expect(SEED).toMatch(/priorSigned/);
  });
});
