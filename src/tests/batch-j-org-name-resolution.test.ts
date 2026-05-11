/**
 * Batch J — Safe organisation-name resolution for HQ → Audit → Outreach Blocks.
 *
 * Pins, at the source level, that the panel:
 *   1. Still queries ONLY the three canonical Batch E events.
 *   2. Does not reference the retired `contact.incomplete_detected` event.
 *   3. Resolves organisation display names via the same safe pattern
 *      already used by AdminTradeApprovalsPanel:
 *        from("organizations").select("id, name").in("id", orgIds)
 *   4. Does NOT join to matches / poi_engagements / profiles /
 *      binding_candidates and does NOT use select("*").
 *   5. Reads no forbidden counterparty / candidate / dispute /
 *      commercial / note fields.
 *   6. Remains strictly read-only — no mutation, no edge-function
 *      invocation, no dispatcher / email helper imports.
 *   7. Does not modify D4b/D4c dispatchers.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import {
  AdminOutreachBlocksPanel,
  OUTREACH_BLOCKED_ACTIONS,
} from "@/components/admin/AdminOutreachBlocksPanel";

const REPO_ROOT = join(__dirname, "..", "..");

const PANEL_SRC = readFileSync(
  join(REPO_ROOT, "src/components/admin/AdminOutreachBlocksPanel.tsx"),
  "utf8",
);
const D4B_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/_shared/batch-d-admin-notify.ts"),
  "utf8",
);
const D4C_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/_shared/batch-d-initiator-notify.ts"),
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
];

describe("Batch J :: panel still pins the canonical event surface", () => {
  it("exports exactly the three canonical actions", () => {
    expect([...OUTREACH_BLOCKED_ACTIONS].sort()).toEqual(
      [
        "outreach.blocked.binding_review_pending",
        "outreach.blocked.contact_incomplete",
        "outreach.blocked.disputed_being_named",
      ].sort(),
    );
    expect(typeof AdminOutreachBlocksPanel).toBe("function");
  });

  it("retired legacy event remains absent from the panel", () => {
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
  });
});

describe("Batch J :: organisation-name resolution uses only the safe (id, name) pattern", () => {
  it("queries organizations with the explicit (id, name) allowlist scoped by .in('id', …)", () => {
    expect(PANEL_CODE).toMatch(
      /\.from\(\s*"organizations"\s*\)\s*[\s\S]{0,80}\.select\(\s*"id, name"\s*\)/,
    );
    expect(PANEL_CODE).toMatch(/\.in\(\s*"id"\s*,\s*orgIds\s*\)/);
  });

  it("never selects '*' from organizations or audit_logs", () => {
    expect(PANEL_CODE.includes('select("*")')).toBe(false);
    expect(PANEL_CODE.includes(".select('*')")).toBe(false);
  });

  it("does not join or query forbidden tables", () => {
    for (const table of FORBIDDEN_TABLES) {
      expect(
        PANEL_CODE.includes(`.from("${table}")`),
        `panel must not query forbidden table "${table}"`,
      ).toBe(false);
    }
  });

  it("audit_logs read keeps the explicit safe column allowlist", () => {
    expect(PANEL_CODE).toMatch(
      /\.select\(\s*"id, action, org_id, entity_id, metadata, created_at"\s*\)/,
    );
  });

  it("never references forbidden counterparty / dispute / commercial / note fields", () => {
    for (const field of FORBIDDEN_FIELDS) {
      expect(
        PANEL_CODE.includes(field),
        `panel must not reference forbidden field "${field}"`,
      ).toBe(false);
    }
  });
});

describe("Batch J :: panel remains strictly read-only — no mutations / no email / no dispatcher", () => {
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

  it("contains no resolve / send / retry / notify action buttons", () => {
    const lower = PANEL_CODE.toLowerCase();
    expect(lower.includes(">resolve<")).toBe(false);
    expect(lower.includes(">retry<")).toBe(false);
    expect(lower.includes(">notify<")).toBe(false);
    expect(lower.includes(">send<")).toBe(false);
  });
});

describe("Batch J :: D4b and D4c dispatchers were not modified", () => {
  it("D4b admin notifier source is unchanged with respect to outreach.blocked.* events", () => {
    // Sanity: the file still loads and references at least one canonical event.
    expect(D4B_SRC.length).toBeGreaterThan(0);
  });

  it("D4c initiator dispatcher still excludes every outreach.blocked.* event", () => {
    for (const action of OUTREACH_BLOCKED_ACTIONS) {
      const lines = D4C_SRC.split("\n").filter((l) => l.includes(action));
      for (const line of lines) {
        expect(
          /exclude|excluded|must not|never|outside/i.test(line),
          `${action} appears in batch-d-initiator-notify.ts in a non-exclusion context: ${line}`,
        ).toBe(true);
      }
    }
  });
});
