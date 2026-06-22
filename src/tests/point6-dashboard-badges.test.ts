/**
 * Point 6 — Dashboard-visible badges (compute-on-read).
 *
 * Proves:
 *   • Thresholds match the approved spec.
 *   • No new alert rows, no cron, no email writes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { computeBadges } from "@/components/usage/Point6DashboardBadges";

const read = (p: string) => readFileSync(resolve(p), "utf8");

describe("Point 6 · dashboard badges", () => {
  it("zero balance fires red", () => {
    const out = computeBadges({ balance: 0, minimumRequired: 10 });
    expect(out.find((b) => b.key === "zero_balance")).toBeTruthy();
  });

  it("low balance fires when balance ≤ minimum * 1.25", () => {
    const out = computeBadges({ balance: 12, minimumRequired: 10 });
    expect(out.find((b) => b.key === "low_balance")).toBeTruthy();
  });

  it("no low/zero badge when comfortably above minimum", () => {
    const out = computeBadges({ balance: 100, minimumRequired: 10 });
    expect(out.find((b) => b.key === "low_balance")).toBeFalsy();
    expect(out.find((b) => b.key === "zero_balance")).toBeFalsy();
  });

  it("key expiring within 14d fires amber", () => {
    const soon = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const out = computeBadges({ nextKeyExpiry: soon });
    const b = out.find((x) => x.key === "key_expiring");
    expect(b).toBeTruthy();
    expect(b!.tone).toBe("amber");
  });

  it("expired key fires red", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const out = computeBadges({ nextKeyExpiry: past });
    const b = out.find((x) => x.key === "key_expiring");
    expect(b?.tone).toBe("red");
  });

  it("suspended/revoked key fires red", () => {
    const out = computeBadges({ suspendedOrRevokedKeys: 1 });
    expect(out.find((b) => b.key === "suspended_or_revoked")).toBeTruthy();
  });

  it("high failed prod calls uses default threshold 25", () => {
    expect(computeBadges({ failedProductionCalls: 26 }).find((b) => b.key === "high_failed_prod")).toBeTruthy();
    expect(computeBadges({ failedProductionCalls: 25 }).find((b) => b.key === "high_failed_prod")).toBeFalsy();
  });

  it("badges component does not write to alert tables, no cron, no email", () => {
    const raw = read("src/components/usage/Point6DashboardBadges.tsx");
    const src = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.insert\(/);
    expect(src).not.toMatch(/\.update\(/);
    expect(src).not.toMatch(/from\(["']api_usage_alerts["']\)/);
    expect(src).not.toMatch(/cron|resend|sendgrid|mailgun|email/i);
  });
});
