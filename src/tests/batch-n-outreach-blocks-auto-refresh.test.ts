/**
 * Batch N — Outreach Blocks "last refreshed" + auto-refresh toggle.
 *
 * Source-level pins that:
 *   1. The panel imports the Switch + Label primitives and date-fns'
 *      formatDistanceToNow.
 *   2. An autoRefresh useState is declared and defaults to false (off).
 *   3. Both the rows query and the count query honour `refetchInterval`
 *      gated on autoRefresh, with refetchIntervalInBackground=false.
 *   4. AUTO_REFRESH_INTERVAL_MS is declared and used.
 *   5. A "last refreshed" element exists with a stable testid.
 *   6. The auto-refresh toggle has a stable testid and the label text
 *      uses plain English ("Auto-refresh (30s)").
 *   7. The safety contract (no forbidden fields, no mutations, no edge
 *      function or dispatcher) is preserved.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..");
const PANEL_SRC = readFileSync(
  join(REPO_ROOT, "src/components/admin/AdminOutreachBlocksPanel.tsx"),
  "utf8",
);

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
const PANEL_CODE = stripComments(PANEL_SRC);

const FORBIDDEN_FIELDS = [
  "counterparty_email",
  "counterparty_name",
  "counterparty_org_id",
  "binding_candidates",
  "dispute_reason",
  "dispute_source",
  "disputed_by_token_hash",
  "commodity",
  "price_amount",
  "quantity_amount",
  "admin_notes",
  "support_notes",
];

describe("Batch N :: imports", () => {
  it("imports Switch and Label primitives", () => {
    expect(PANEL_CODE).toMatch(/from\s+["']@\/components\/ui\/switch["']/);
    expect(PANEL_CODE).toMatch(/from\s+["']@\/components\/ui\/label["']/);
  });
  it("imports formatDistanceToNow from date-fns", () => {
    expect(PANEL_CODE).toMatch(/formatDistanceToNow[^;]*from\s+["']date-fns["']/);
  });
});

describe("Batch N :: auto-refresh state and interval", () => {
  it("declares AUTO_REFRESH_INTERVAL_MS as a numeric constant", () => {
    expect(PANEL_CODE).toMatch(/const\s+AUTO_REFRESH_INTERVAL_MS\s*=\s*\d/);
  });
  it("declares an autoRefresh useState that defaults to false", () => {
    expect(PANEL_CODE).toMatch(/useState\(\s*false\s*\)/);
    expect(PANEL_CODE).toMatch(/setAutoRefresh/);
  });
  it("rows query honours autoRefresh-gated refetchInterval", () => {
    const region = PANEL_CODE.split('"admin-outreach-blocks"')[1] ?? "";
    expect(region).toMatch(
      /refetchInterval:\s*autoRefresh\s*\?\s*AUTO_REFRESH_INTERVAL_MS\s*:\s*false/,
    );
    expect(region).toMatch(/refetchIntervalInBackground:\s*false/);
  });
  it("count query honours autoRefresh-gated refetchInterval", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region).toMatch(
      /refetchInterval:\s*autoRefresh\s*\?\s*AUTO_REFRESH_INTERVAL_MS\s*:\s*false/,
    );
    expect(region).toMatch(/refetchIntervalInBackground:\s*false/);
  });
});

describe("Batch N :: UI surfaces", () => {
  it("renders an auto-refresh toggle with a stable testid", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-auto-refresh-control"/);
    expect(PANEL_SRC).toMatch(/Auto-refresh \(30s\)/);
  });
  it("renders a 'last refreshed' indicator with a stable testid", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-last-refreshed"/);
    expect(PANEL_SRC).toMatch(/Last refreshed/);
  });
  it("derives last-refreshed from react-query dataUpdatedAt (no DB roundtrip)", () => {
    expect(PANEL_CODE).toMatch(/query\.dataUpdatedAt/);
    expect(PANEL_CODE).toMatch(/countQuery\.dataUpdatedAt/);
  });
});

describe("Batch N :: safety contract preserved", () => {
  it("never references forbidden counterparty / dispute / commercial / note fields", () => {
    for (const field of FORBIDDEN_FIELDS) {
      expect(
        PANEL_CODE.includes(field),
        `panel must not reference forbidden field "${field}"`,
      ).toBe(false);
    }
  });
  it("does not query forbidden tables", () => {
    for (const table of [
      "matches",
      "poi_engagements",
      "profiles",
      "binding_candidates",
      "counterparties",
    ]) {
      expect(PANEL_CODE.includes(`.from("${table}")`)).toBe(false);
    }
  });
  it("does not call any Supabase mutation method", () => {
    for (const fn of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(PANEL_CODE.includes(fn)).toBe(false);
    }
  });
  it("does not invoke any edge function or dispatcher from the panel", () => {
    expect(PANEL_CODE.includes("functions.invoke")).toBe(false);
    expect(PANEL_CODE.includes("/functions/v1/")).toBe(false);
    expect(PANEL_CODE.includes("fetchEdgeFunction")).toBe(false);
    expect(PANEL_CODE.includes("notification-dispatch")).toBe(false);
  });
  it("keeps contact.incomplete_detected retired", () => {
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
    expect(PANEL_CODE.includes("'contact.incomplete_detected'")).toBe(false);
  });
});
