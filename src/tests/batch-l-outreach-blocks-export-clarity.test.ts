/**
 * Batch L — Outreach Blocks panel polish & export transparency.
 *
 * Source-level pins that:
 *   1. The Export CSV explanatory text exists in the panel.
 *   2. The 500-row cap warning exists and is gated on `rows.length >= ROW_LIMIT`.
 *   3. The empty-state message exists for "no rows match".
 *   4. The CSV column allowlist is unchanged from Batch K.
 *   5. No forbidden field is referenced.
 *   6. No mutation, edge function, or dispatcher path was added.
 *   7. outreach.blocked.* events remain audit-only and contact.incomplete_detected stays retired.
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

describe("Batch L :: export explainer text", () => {
  it("renders an explainer block near Export CSV", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-export-explainer"/);
  });

  it("explains that the CSV reflects the currently filtered rows", () => {
    expect(PANEL_SRC).toMatch(/currently shown above|currently filtered|currently visible/i);
    expect(PANEL_SRC).toMatch(/time window/i);
    expect(PANEL_SRC).toMatch(/reason/i);
    expect(PANEL_SRC).toMatch(/surface/i);
  });

  it("explicitly lists what the CSV does NOT include (layman's terms)", () => {
    expect(PANEL_SRC).toMatch(/counterparty/i);
    expect(PANEL_SRC).toMatch(/dispute/i);
    expect(PANEL_SRC).toMatch(/candidate/i);
    expect(PANEL_SRC).toMatch(/commercial|commodity|price|quantity/i);
    expect(PANEL_SRC).toMatch(/admin or support notes|admin\/support notes|support notes/i);
  });
});

describe("Batch L :: 500-row cap warning", () => {
  it("renders a cap warning element gated on rows.length >= ROW_LIMIT", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-cap-warning"/);
    expect(PANEL_CODE).toMatch(/rows\.length\s*>=\s*ROW_LIMIT/);
  });

  it("uses honest wording about narrowing filters", () => {
    expect(PANEL_SRC).toMatch(/first\s+\{?ROW_LIMIT\}?\s+matching audit rows|first 500 matching audit rows/i);
    expect(PANEL_SRC).toMatch(/narrow the filters/i);
  });

  it("does not silently raise the 500-row cap", () => {
    expect(PANEL_CODE).toMatch(/const ROW_LIMIT = 500/);
  });
});

describe("Batch L :: empty-state message", () => {
  it("renders an empty-state element when there are no rows (not via toast)", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-empty-state"/);
    expect(PANEL_CODE).toMatch(/rows\.length\s*===\s*0/);
  });

  it("explains that Export CSV is disabled until rows exist", () => {
    expect(PANEL_SRC).toMatch(/No rows match the current filters/i);
  });
});

describe("Batch L :: CSV column allowlist unchanged from Batch K", () => {
  const REQUIRED_HEADERS = [
    "Created At",
    "Reason",
    "Action",
    "Organisation Name",
    "Organisation ID",
    "Engagement ID",
    "Surface",
  ];

  it("includes exactly the safe header allowlist", () => {
    for (const h of REQUIRED_HEADERS) {
      expect(PANEL_SRC.includes(`"${h}"`), `CSV must include header "${h}"`).toBe(true);
    }
  });

  it("does not introduce any new CSV column header", () => {
    const exportRegion =
      PANEL_SRC.split("Export CSV")[0].split("const headers = [")[1] ?? "";
    const headerBlock = exportRegion.split("]")[0] ?? "";
    const literals = [...headerBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual([...REQUIRED_HEADERS].sort());
  });
});

describe("Batch L :: safety contract preserved", () => {
  it("never references forbidden counterparty / dispute / commercial / note fields", () => {
    for (const field of FORBIDDEN_FIELDS) {
      expect(
        PANEL_CODE.includes(field),
        `panel must not reference forbidden field "${field}"`,
      ).toBe(false);
    }
  });

  it("does not query forbidden tables", () => {
    for (const table of ["matches", "poi_engagements", "profiles", "binding_candidates", "counterparties"]) {
      expect(PANEL_CODE.includes(`.from("${table}")`)).toBe(false);
    }
  });

  it("does not call any Supabase mutation method", () => {
    for (const fn of [".insert(", ".update(", ".upsert(", ".delete("]) {
      expect(PANEL_CODE.includes(fn)).toBe(false);
    }
  });

  it("does not invoke any edge function from the panel", () => {
    expect(PANEL_CODE.includes("functions.invoke")).toBe(false);
    expect(PANEL_CODE.includes("/functions/v1/")).toBe(false);
    expect(PANEL_CODE.includes("fetchEdgeFunction")).toBe(false);
  });

  it("does not import any notification / dispatcher / email helper", () => {
    expect(PANEL_CODE.includes("batch-d-admin-notify")).toBe(false);
    expect(PANEL_CODE.includes("batch-d-initiator-notify")).toBe(false);
    expect(PANEL_CODE.includes("notification-dispatch")).toBe(false);
  });

  it("keeps contact.incomplete_detected retired", () => {
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
    expect(PANEL_CODE.includes("'contact.incomplete_detected'")).toBe(false);
  });
});
