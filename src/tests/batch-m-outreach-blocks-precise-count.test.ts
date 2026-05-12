/**
 * Batch M — Outreach Blocks precise row count and export confidence polish.
 *
 * Source-level pins that:
 *   1. The panel issues a precise count query using the same filters
 *      (action, surface, time window) as the visible row query.
 *   2. The count query is head/count-only — it does not select any
 *      unsafe metadata, counterparty, dispute, candidate, commercial,
 *      or notes field.
 *   3. The truncation warning is gated on the precise count when
 *      available (totalCount > ROW_LIMIT), and falls back to the
 *      `rows.length >= ROW_LIMIT` heuristic when the count is not.
 *   4. CSV columns and the safety contract are unchanged from K/L.
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

describe("Batch M :: precise count query exists with safe shape", () => {
  it("issues a count: 'exact', head: true query against audit_logs", () => {
    expect(PANEL_CODE).toMatch(/count:\s*["']exact["']/);
    expect(PANEL_CODE).toMatch(/head:\s*true/);
    expect(PANEL_CODE).toMatch(
      /\.from\(\s*"audit_logs"\s*\)\s*[\s\S]{0,200}\.select\(\s*"id"\s*,\s*\{\s*count:\s*"exact"\s*,\s*head:\s*true\s*\}\s*\)/,
    );
  });

  it("count query reuses the canonical OUTREACH_BLOCKED_ACTIONS allowlist", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region.includes("OUTREACH_BLOCKED_ACTIONS")).toBe(true);
    expect(region).toMatch(/\.in\(\s*"action"\s*,/);
  });

  it("count query mirrors the action filter", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region).toMatch(/actionFilter\s*!==\s*"all"/);
    expect(region).toMatch(/\.eq\(\s*"action"\s*,\s*actionFilter\s*\)/);
  });

  it("count query mirrors the time-window filter", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region).toMatch(/WINDOW_OPTIONS/);
    expect(region).toMatch(/\.gte\(\s*"created_at"\s*,/);
  });

  it("count query mirrors the surface filter via the safe metadata->>surface JSON path", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1] ?? "";
    expect(region).toMatch(/surfaceFilter\s*!==\s*"all"/);
    expect(region).toMatch(/\.eq\(\s*"metadata->>surface"\s*,\s*surfaceFilter\s*\)/);
  });

  it("count query does not select any unsafe field", () => {
    const region = PANEL_CODE.split("admin-outreach-blocks-count")[1]?.split("countQuery")[0] ?? "";
    // Only "id" should be selected in the head/count call.
    expect(region.includes('select("metadata"')).toBe(false);
    expect(region.includes('"org_id"')).toBe(false);
    expect(region.includes('"entity_id"')).toBe(false);
    for (const f of FORBIDDEN_FIELDS) {
      expect(region.includes(f), `count region must not reference "${f}"`).toBe(false);
    }
  });
});

describe("Batch M :: truncation warning uses precise count with heuristic fallback", () => {
  it("declares an isTruncated derived value driven by the count when available", () => {
    expect(PANEL_CODE).toMatch(/const\s+isTruncated\s*=/);
    expect(PANEL_CODE).toMatch(/totalCount/);
    expect(PANEL_CODE).toMatch(/countAvailable/);
  });

  it("precise branch fires only when totalCount > ROW_LIMIT", () => {
    expect(PANEL_CODE).toMatch(/totalCount\s*as\s*number\s*\)\s*>\s*ROW_LIMIT/);
  });

  it("falls back to rows.length >= ROW_LIMIT heuristic when count is unavailable", () => {
    expect(PANEL_CODE).toMatch(/rows\.length\s*>=\s*ROW_LIMIT/);
  });

  it("cap warning is now gated on isTruncated, not directly on rows.length", () => {
    expect(PANEL_CODE).toMatch(/\{\s*isTruncated\s*&&/);
  });

  it("cap warning element is preserved and uses honest precise wording when count is known", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-cap-warning"/);
    expect(PANEL_SRC).toMatch(/Showing the first \{?ROW_LIMIT\}? of/);
    expect(PANEL_SRC).toMatch(/narrow the filters/i);
  });

  it("does not silently raise the 500-row cap", () => {
    expect(PANEL_CODE).toMatch(/const ROW_LIMIT = 500/);
  });
});

describe("Batch M :: visible plain-English count text", () => {
  it("renders a count text element", () => {
    expect(PANEL_CODE).toMatch(/data-testid="outreach-blocks-count-text"/);
  });

  it("uses 'X of Y matching outreach-blocked events' wording when count is available", () => {
    expect(PANEL_SRC).toMatch(/of \$\{[^}]+totalCount[^}]+\}[^`]*matching outreach-blocked events/);
  });
});

describe("Batch M :: CSV column allowlist unchanged from K/L", () => {
  const REQUIRED_HEADERS = [
    "Created At",
    "Reason",
    "Action",
    "Organisation Name",
    "Organisation ID",
    "Engagement ID",
    "Surface",
  ];

  it("keeps exactly the safe header allowlist", () => {
    const exportRegion =
      PANEL_SRC.split("Export CSV")[0].split("const headers = [")[1] ?? "";
    const headerBlock = exportRegion.split("]")[0] ?? "";
    const literals = [...headerBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(literals.sort()).toEqual([...REQUIRED_HEADERS].sort());
  });

  it("CSV export still maps over the panel's already-filtered `rows`", () => {
    const idx = PANEL_SRC.indexOf("Export CSV");
    const before = PANEL_SRC.slice(Math.max(0, idx - 1500), idx);
    expect(before.includes("rows.map(")).toBe(true);
    expect(before.includes("supabase.from(")).toBe(false);
    expect(before.includes("await ")).toBe(false);
  });
});

describe("Batch M :: safety contract preserved", () => {
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
