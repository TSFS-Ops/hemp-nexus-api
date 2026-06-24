/**
 * Bucket D evidence-only containment guard.
 *
 * Asserts that the eight residual internal/demo acceptance-receipt
 * "not notified" rows are documented in
 * evidence/acceptance-receipt-delivery-backlog/README.md with the
 * required containment statements, and that no migration file was
 * added for this batch.
 *
 * Evidence/test-only guard. No DB, no email, no provider.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const README = resolve(
  "evidence/acceptance-receipt-delivery-backlog/README.md",
);
const md = readFileSync(README, "utf8");

const RISK_IDS = [
  "3e00ea7e-6420-47b9-aecd-44807b10eda1",
  "4743bc79-c26e-41e6-928a-044ce7dbe307",
  "e4eda158-c49e-4f97-857a-74bb820749c5",
  "65522fdd-05ae-4753-8113-3f0084214f8c",
  "62e1cd71-a9d5-4bcb-ba43-e416e82ff940",
  "cc7d8fed-45f3-4096-8105-5a4811849a36",
  "342e3afe-c955-42f8-8a06-84c2d9f50af6",
  "2f058d83-b06e-40f5-8736-2258f19c887d",
];

describe("Bucket D — evidence-only containment", () => {
  it("evidence README lists all 8 residual risk_ids", () => {
    for (const id of RISK_IDS) {
      expect(md).toContain(id);
    }
  });

  it("evidence README declares the containment status", () => {
    expect(md).toContain(
      "ACCEPTANCE_RECEIPT_BUCKET_D_INTERNAL_DEMO_CONTAINMENT_COMPLETE",
    );
    expect(md).toMatch(/Residual Bucket D/i);
  });

  it("evidence README states no resend is recommended", () => {
    expect(md).toMatch(/Manual resend is \*\*not recommended\*\*/);
    expect(md).toMatch(/MUST NOT be resent/);
  });

  it("evidence README states no auto-resolve was applied and explains why", () => {
    expect(md).toMatch(/intentionally not[\s\S]{0,20}applied/i);
    expect(md).toMatch(/weaken future detection/i);
  });

  it("evidence README points closure at the canonical admin-resolve path only", () => {
    expect(md).toMatch(/resolve_admin_risk_item/);
    expect(md).toMatch(/canonical admin-resolve path/i);
  });

  it("evidence README records a consolidated CLIENT_DECISION", () => {
    expect(md).toMatch(/CLIENT_DECISION/);
    expect(md).toMatch(/2026-04-25/);
    expect(md).toMatch(/2026-05-04/);
  });

  it("evidence README confirms zero dispatch / log evidence for each row", () => {
    expect(md).toMatch(/notification_dispatches[\s\S]*?=\s*0/);
    expect(md).toMatch(/email_send_log[\s\S]*?=\s*0/);
  });
});

describe("Bucket D — scope: no migration in this batch", () => {
  it("no migration file references bucket_d / internal_demo containment", () => {
    const migDir = resolve("supabase/migrations");
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql"));
    for (const f of files) {
      const sql = readFileSync(resolve(migDir, f), "utf8");
      expect(sql).not.toMatch(/bucket[_-]?d[_-]?internal[_-]?demo/i);
      expect(sql).not.toMatch(
        /ACCEPTANCE_RECEIPT_BUCKET_D_INTERNAL_DEMO_CONTAINMENT/i,
      );
    }
  });
});
