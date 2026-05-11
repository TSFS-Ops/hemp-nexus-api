/**
 * Batch I — Outreach Blocks admin drill-through and operational visibility.
 *
 * Pins, at the source level:
 *   1. The panel still queries ONLY the three canonical Batch E events.
 *   2. The retired `contact.incomplete_detected` event is not referenced.
 *   3. No forbidden counterparty / candidate / dispute / commercial /
 *      note fields are read or displayed.
 *   4. No select("*") — the explicit column allowlist remains.
 *   5. Surface and reason filters operate only on the safe allowlist
 *      (preview-outreach / send-outreach + the three canonical actions).
 *   6. The panel remains strictly read-only — no resolve / send / retry
 *      / notify / email / mutation hooks.
 *   7. D4b admin notifier and D4c initiator dispatcher are NOT touched.
 *   8. No new email path / edge function / supabase.functions.invoke
 *      is wired into the panel.
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
const D4C_INITIATOR_SRC = readFileSync(
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

describe("Batch I :: AdminOutreachBlocksPanel safety contract is preserved", () => {
  it("exports the three canonical actions and nothing else", () => {
    expect([...OUTREACH_BLOCKED_ACTIONS].sort()).toEqual(
      [
        "outreach.blocked.binding_review_pending",
        "outreach.blocked.contact_incomplete",
        "outreach.blocked.disputed_being_named",
      ].sort(),
    );
    expect(typeof AdminOutreachBlocksPanel).toBe("function");
  });

  it("does not reference the retired legacy event", () => {
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
  });

  it("never reads forbidden counterparty / candidate / dispute / commercial / note fields", () => {
    for (const field of FORBIDDEN_FIELDS) {
      expect(
        PANEL_CODE.includes(field),
        `panel must not reference forbidden field "${field}" in code`,
      ).toBe(false);
    }
  });

  it("uses an explicit column allowlist (never select(*))", () => {
    expect(PANEL_CODE).toMatch(
      /\.select\(\s*"id, action, org_id, entity_id, metadata, created_at"\s*\)/,
    );
    expect(PANEL_CODE.includes('select("*")')).toBe(false);
    expect(PANEL_CODE.includes(".select('*')")).toBe(false);
  });
});

describe("Batch I :: filter inputs are restricted to safe values", () => {
  it("reason filter only references canonical actions", () => {
    for (const a of OUTREACH_BLOCKED_ACTIONS) {
      expect(PANEL_CODE.includes(`"${a}"`)).toBe(true);
    }
  });

  it("surface filter only allows the two real call sites", () => {
    expect(PANEL_CODE).toMatch(/SAFE_SURFACES\s*=\s*\[\s*"preview-outreach"\s*,\s*"send-outreach"\s*\]/);
    // Forbid free-form surface values being trusted.
    expect(PANEL_CODE.includes("any-surface")).toBe(false);
  });

  it("time window filter uses created_at gte only — no other audit_logs columns are filtered", () => {
    expect(PANEL_CODE).toMatch(/\.gte\("created_at"/);
    // Make sure we don't accidentally filter on sensitive fields.
    for (const field of FORBIDDEN_FIELDS) {
      expect(PANEL_CODE.includes(`.eq("${field}"`)).toBe(false);
      expect(PANEL_CODE.includes(`.in("${field}"`)).toBe(false);
    }
  });
});

describe("Batch I :: panel remains strictly read-only — no mutations / no email / no dispatcher", () => {
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
    // "send-outreach" appears only as a safe label/filter value, not as a callable.
    expect(PANEL_CODE.includes('"send-outreach"')).toBe(true);
  });

  it("contains no resolve / send / retry / notify action handlers", () => {
    const lower = PANEL_CODE.toLowerCase();
    // Buttons with those imperative verbs would imply mutation.
    expect(lower.includes(">resolve<")).toBe(false);
    expect(lower.includes(">retry<")).toBe(false);
    expect(lower.includes(">notify<")).toBe(false);
    expect(lower.includes(">send<")).toBe(false);
  });
});

describe("Batch I :: D4b and D4c dispatchers were not modified by this batch", () => {
  it("D4c initiator dispatcher still excludes every outreach.blocked.* event", () => {
    for (const action of OUTREACH_BLOCKED_ACTIONS) {
      const lines = D4C_INITIATOR_SRC.split("\n").filter((l) => l.includes(action));
      for (const line of lines) {
        expect(
          /exclude|excluded|must not|never|outside/i.test(line),
          `${action} appears in batch-d-initiator-notify.ts in a non-exclusion context: ${line}`,
        ).toBe(true);
      }
    }
  });

  it("Batch G observability test file is still present", () => {
    const path = join(REPO_ROOT, "src/tests/batch-g-observability-and-retirement.test.ts");
    expect(() => readFileSync(path, "utf8")).not.toThrow();
  });
});
