/**
 * Batch G — Admin observability + legacy retirement preparation.
 *
 * Pins, at the source level:
 *   1. The Admin Outreach Blocks panel only reads a tight allowlist of
 *      safe columns from audit_logs. It must NEVER select(*) and must
 *      NEVER read counterparty / candidate / dispute / commercial /
 *      admin-note fields.
 *   2. The panel only filters on the three canonical Batch E events.
 *   3. Every outreach.blocked.* event remains audit-only
 *      (`adminDispatchEnabled: false`) and is excluded from the D4c
 *      initiator dispatcher.
 *   4. The legacy `contact.incomplete_detected` audit emit is dual-
 *      written from the SAME gate paths as the canonical
 *      `outreach.blocked.contact_incomplete` event — never on its own.
 *   5. The retirement note is present in the source so future builders
 *      know the rules before removing the legacy event.
 *   6. The by-match response hardening (Batch F) is still in place.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { BATCH_D_EVENTS } from "@/lib/batch-d-events";
import {
  AdminOutreachBlocksPanel,
  OUTREACH_BLOCKED_ACTIONS,
} from "@/components/admin/AdminOutreachBlocksPanel";

const REPO_ROOT = join(__dirname, "..", "..");

const PANEL_SRC = readFileSync(
  join(REPO_ROOT, "src/components/admin/AdminOutreachBlocksPanel.tsx"),
  "utf8",
);
const POI_ENGAGEMENTS_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/poi-engagements/index.ts"),
  "utf8",
);
const D4C_INITIATOR_SRC = readFileSync(
  join(REPO_ROOT, "supabase/functions/_shared/batch-d-initiator-notify.ts"),
  "utf8",
);
// Strip JS/TS comments from the panel source before scanning for
// forbidden field names. The panel's own header comment legitimately
// names the fields it must NOT read — that documentation must not
// trip the safety guard.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
}
const PANEL_CODE = stripComments(PANEL_SRC);

const FORBIDDEN_FIELDS_IN_PANEL = [
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

describe("Batch G :: AdminOutreachBlocksPanel safety contract", () => {
  it("only declares the three canonical outreach.blocked.* actions", () => {
    expect([...OUTREACH_BLOCKED_ACTIONS].sort()).toEqual(
      [
        "outreach.blocked.binding_review_pending",
        "outreach.blocked.contact_incomplete",
        "outreach.blocked.disputed_being_named",
      ].sort(),
    );
    // Panel is a real React component (smoke).
    expect(typeof AdminOutreachBlocksPanel).toBe("function");
  });

  it("never reads or displays forbidden counterparty / dispute / commercial / note fields", () => {
    for (const field of FORBIDDEN_FIELDS_IN_PANEL) {
      expect(
        PANEL_CODE.includes(field),
        `AdminOutreachBlocksPanel must not reference forbidden field "${field}" in code (comments excluded)`,
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

  it("filters audit_logs by the three canonical actions only", () => {
    for (const a of OUTREACH_BLOCKED_ACTIONS) {
      expect(
        PANEL_CODE.includes(`"${a}"`),
        `panel must reference canonical action "${a}"`,
      ).toBe(true);
    }
    expect(PANEL_CODE.includes('"contact.incomplete_detected"')).toBe(false);
  });
});

describe("Batch G :: outreach.blocked.* stay audit-only", () => {
  it("every outreach.blocked.* catalogue entry has adminDispatchEnabled:false", () => {
    for (const action of OUTREACH_BLOCKED_ACTIONS) {
      const entry = BATCH_D_EVENTS.find((e) => e.event === action);
      expect(entry, `missing catalogue entry for ${action}`).toBeDefined();
      expect(entry!.adminDispatchEnabled).toBe(false);
      expect(entry!.recommendation).toBe("audit_only");
    }
  });

  it("D4c initiator dispatcher does not allow any outreach.blocked.* event", () => {
    for (const action of OUTREACH_BLOCKED_ACTIONS) {
      const lines = D4C_INITIATOR_SRC.split("\n").filter((l) =>
        l.includes(action),
      );
      for (const line of lines) {
        expect(
          /exclude|excluded|must not|never|outside/i.test(line),
          `${action} appears in batch-d-initiator-notify.ts in a non-exclusion context: ${line}`,
        ).toBe(true);
      }
    }
  });
});

describe("Batch G :: legacy contact.incomplete_detected dual-write integrity", () => {
  it("legacy event is only emitted alongside the canonical event in poi-engagements", () => {
    // Find every line that mentions the legacy action.
    const lines = POI_ENGAGEMENTS_SRC.split("\n");
    const legacyIdxs = lines
      .map((l, i) => (l.includes('"contact.incomplete_detected"') ? i : -1))
      .filter((i) => i >= 0);

    expect(
      legacyIdxs.length,
      "expected at least one legacy emit site",
    ).toBeGreaterThanOrEqual(1);

    for (const idx of legacyIdxs) {
      // The legacy literal must sit inside a small window that ALSO
      // contains the canonical literal. We allow a +/- 6 line window
      // because the two strings live in the same array literal.
      const start = Math.max(0, idx - 6);
      const end = Math.min(lines.length - 1, idx + 6);
      const window = lines.slice(start, end + 1).join("\n");
      expect(
        window.includes('"outreach.blocked.contact_incomplete"'),
        `legacy emit at line ${idx + 1} is not paired with canonical emit in the same array literal`,
      ).toBe(true);
    }
  });

  it("retirement note is present in the source", () => {
    expect(POI_ENGAGEMENTS_SRC).toMatch(/Batch G[^\n]*RETIREMENT NOTE/);
    // Spell out the key removal rule so a future edit cannot silently
    // weaken it.
    expect(POI_ENGAGEMENTS_SRC).toMatch(/MUST NOT be used by any new/);
  });
});

describe("Batch G :: by-match response hardening still in place (Batch F)", () => {
  // Batch F stripped these fields from the initiator-facing response.
  // We only assert that NONE of these fields are returned as object
  // properties (i.e. not present as a `field:` write into the response
  // payload). Source-level grep is sufficient as a regression guard.
  const STRIPPED = [
    "binding_candidates",
    "dispute_reason",
    "dispute_source",
    "disputed_by_token_hash",
    "admin_notes",
    "support_notes",
  ];

  it("stripped fields are not assigned into the by-match response payload", () => {
    if (BY_MATCH_SRC.length === 0) return; // nothing to check
    for (const field of STRIPPED) {
      // Forbid `field:` writes into a response object (e.g.
      // `binding_candidates: row.binding_candidates`). Reading the
      // field internally to make decisions is fine — that is `.field`
      // / `["field"]` access, which this regex does not match.
      const writeRe = new RegExp(`(^|[\\s,{])${field}\\s*:`, "m");
      const matches = BY_MATCH_SRC.match(new RegExp(writeRe, "gm")) ?? [];
      // Allow at most uses inside SQL select strings or column lists,
      // which are double-quoted. We filter those out.
      const offending = matches.filter((m) => !/"/.test(m));
      expect(
        offending.length,
        `forbidden response write for "${field}": ${offending.join(" | ")}`,
      ).toBe(0);
    }
  });
});
