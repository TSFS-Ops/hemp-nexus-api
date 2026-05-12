/**
 * Batch N polish — Admin operations readiness for AdminOutreachBlocksPanel.
 *
 * Source-level pins that:
 *   1. The panel renders an explicit read-only notice with a stable testid.
 *   2. The panel surfaces query / count errors via a dedicated banner with
 *      a stable testid, and offers a Retry that re-runs both queries.
 *   3. The error banner is gated on react-query's isError / error fields
 *      (no swallowed errors, no silent stale view).
 *   4. The existing safety contract is preserved:
 *        • no forbidden counterparty / dispute / commercial / note fields;
 *        • no forbidden-table reads (matches, poi_engagements, profiles,
 *          binding_candidates, counterparties);
 *        • no Supabase mutation methods;
 *        • no edge-function invocation, dispatcher import, or notification
 *          path;
 *        • contact.incomplete_detected remains retired.
 *   5. The CSV export header list is unchanged (seven columns, exact order).
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

const FORBIDDEN_TABLES = [
  "matches",
  "poi_engagements",
  "profiles",
  "binding_candidates",
  "counterparties",
];

describe("Batch N polish :: read-only notice", () => {
  it("renders a read-only notice with a stable testid", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-readonly-notice"/);
  });

  it("notice copy makes the read-only nature explicit", () => {
    expect(PANEL_SRC).toMatch(/Read-only view/);
    expect(PANEL_SRC).toMatch(/No\s+outreach,\s+notification,\s+or\s+row\s+resolution/);
  });
});

describe("Batch N polish :: query error surface", () => {
  it("derives error state from react-query isError / error", () => {
    expect(PANEL_CODE).toMatch(/query\.isError/);
    expect(PANEL_CODE).toMatch(/countQuery\.isError/);
  });

  it("renders a dedicated error banner with a stable testid", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-query-error"/);
    expect(PANEL_SRC).toMatch(/Could not load outreach-blocked events/);
  });

  it("banner is gated on hasError and never shown unconditionally", () => {
    expect(PANEL_CODE).toMatch(/\{hasError\s*&&/);
  });

  it("banner offers a Retry that re-runs both queries", () => {
    const region = PANEL_CODE.split("outreach-blocks-query-error")[1] ?? "";
    expect(region).toMatch(/query\.refetch\(\)/);
    expect(region).toMatch(/countQuery\.refetch\(\)/);
    expect(region).toMatch(/>Retry</);
  });

  it("warns the operator that the visible view may be stale", () => {
    expect(PANEL_SRC).toMatch(/may be stale or incomplete/i);
  });
});

describe("Batch N polish :: safety contract preserved", () => {
  it("never references forbidden counterparty / dispute / commercial / note fields", () => {
    for (const field of FORBIDDEN_FIELDS) {
      expect(
        PANEL_CODE.includes(field),
        `panel must not reference forbidden field "${field}"`,
      ).toBe(false);
    }
  });

  it("does not query forbidden tables", () => {
    for (const table of FORBIDDEN_TABLES) {
      expect(
        PANEL_CODE.includes(`.from("${table}")`),
        `panel must not query forbidden table "${table}"`,
      ).toBe(false);
    }
  });

  it("does not call any Supabase mutation method", () => {
    for (const fn of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(PANEL_CODE.includes(fn)).toBe(false);
    }
  });

  it("does not invoke any edge function, dispatcher, or notification helper", () => {
    expect(PANEL_CODE.includes("functions.invoke")).toBe(false);
    expect(PANEL_CODE.includes("/functions/v1/")).toBe(false);
    expect(PANEL_CODE.includes("fetchEdgeFunction")).toBe(false);
    expect(PANEL_CODE.includes("notification-dispatch")).toBe(false);
    expect(PANEL_CODE.includes("batch-d-admin-notify")).toBe(false);
    expect(PANEL_CODE.includes("batch-d-initiator-notify")).toBe(false);
  });

  it("keeps contact.incomplete_detected retired", () => {
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
    expect(PANEL_CODE.includes("'contact.incomplete_detected'")).toBe(false);
  });
});

describe("Batch N polish :: CSV export header list unchanged", () => {
  it("still exports exactly the seven safe columns in order", () => {
    const headerBlock = PANEL_SRC.match(
      /const headers = \[([\s\S]*?)\];/,
    )?.[1] ?? "";
    const headers = headerBlock
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    expect(headers).toEqual([
      "Created At",
      "Reason",
      "Action",
      "Organisation Name",
      "Organisation ID",
      "Engagement ID",
      "Surface",
    ]);
  });
});
