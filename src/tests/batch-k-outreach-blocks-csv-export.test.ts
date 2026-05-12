/**
 * Batch K — Safe CSV export for HQ → Audit → Outreach Blocks.
 *
 * Pins, at the source level, that the export:
 *   1. Is wired to an Export CSV button on the panel.
 *   2. Uses only the safe column allowlist:
 *        Created At, Reason, Action, Organisation Name,
 *        Organisation ID, Engagement ID, Surface
 *   3. Does NOT reference any forbidden counterparty / dispute /
 *      candidate / commercial / note fields.
 *   4. Does NOT call any mutation, edge function, or dispatcher.
 *   5. Does NOT reference the retired `contact.incomplete_detected`
 *      event.
 *   6. Uses only the three canonical Batch E events.
 *   7. Reuses the panel's already-filtered `rows` + `orgNames` —
 *      no new broad query.
 *   8. Keeps the explicit safe column allowlists for audit_logs and
 *      organizations.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { OUTREACH_BLOCKED_ACTIONS } from "@/components/admin/AdminOutreachBlocksPanel";

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

describe("Batch K :: Export CSV button is present", () => {
  it("renders an Export CSV button label", () => {
    expect(PANEL_SRC.includes("Export CSV")).toBe(true);
  });

  it("imports the shared safe CSV download helpers", () => {
    expect(PANEL_CODE).toMatch(
      /from\s+["']@\/lib\/download-utils["']/,
    );
    expect(PANEL_CODE.includes("downloadCSV")).toBe(true);
    expect(PANEL_CODE.includes("timestampedFilename")).toBe(true);
  });
});

describe("Batch K :: CSV column allowlist", () => {
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
      expect(
        PANEL_SRC.includes(`"${h}"`),
        `CSV must include header "${h}"`,
      ).toBe(true);
    }
  });

  it("does not include forbidden column headers", () => {
    const forbiddenHeaders = [
      "Counterparty",
      "Dispute",
      "Candidates",
      "Commodity",
      "Price",
      "Quantity",
      "Admin Notes",
      "Support Notes",
    ];
    // Headers are only string literals in the CSV array; check the export region.
    const exportRegion =
      PANEL_SRC.split("Export CSV")[0].split("const headers = [")[1] ?? "";
    const headerBlock = exportRegion.split("]")[0] ?? "";
    for (const fh of forbiddenHeaders) {
      expect(
        headerBlock.includes(fh),
        `CSV header block must not include "${fh}"`,
      ).toBe(false);
    }
  });
});

describe("Batch K :: forbidden fields and tables are not referenced", () => {
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

  it("never selects '*'", () => {
    expect(PANEL_CODE.includes('select("*")')).toBe(false);
    expect(PANEL_CODE.includes(".select('*')")).toBe(false);
  });
});

describe("Batch K :: no mutations, no edge functions, no dispatchers", () => {
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
});

describe("Batch K :: canonical events only", () => {
  it("does not reference the retired contact.incomplete_detected event", () => {
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
    expect(PANEL_CODE.includes("'contact.incomplete_detected'")).toBe(false);
  });

  it("uses only the three canonical Batch E events", () => {
    expect([...OUTREACH_BLOCKED_ACTIONS].sort()).toEqual(
      [
        "outreach.blocked.binding_review_pending",
        "outreach.blocked.contact_incomplete",
        "outreach.blocked.disputed_being_named",
      ].sort(),
    );
  });
});

describe("Batch K :: explicit safe select allowlists preserved", () => {
  it("audit_logs read keeps the explicit safe column allowlist", () => {
    expect(PANEL_CODE).toMatch(
      /\.select\(\s*"id, action, org_id, entity_id, metadata, created_at"\s*\)/,
    );
  });

  it("organizations read keeps the (id, name) allowlist", () => {
    expect(PANEL_CODE).toMatch(
      /\.from\(\s*"organizations"\s*\)\s*[\s\S]{0,80}\.select\(\s*"id, name"\s*\)/,
    );
  });
});

describe("Batch K :: export reuses already-filtered rows (no broad query)", () => {
  it("Export CSV onClick maps over the panel's `rows`, not a fresh query", () => {
    // The export region must reference `rows.map(` and must not run a new
    // supabase query inside the click handler.
    const idx = PANEL_SRC.indexOf("Export CSV");
    expect(idx).toBeGreaterThan(0);
    // Search backwards for the surrounding Button block.
    const before = PANEL_SRC.slice(Math.max(0, idx - 1500), idx);
    expect(before.includes("rows.map(")).toBe(true);
    expect(before.includes("orgNames")).toBe(true);
    expect(before.includes("supabase.from(")).toBe(false);
    expect(before.includes("await ")).toBe(false);
  });
});
