/**
 * Batch D — D4c-2 helper ↔ source-of-truth parity test.
 *
 * The Deno helper `_shared/batch-d-initiator-notify.ts` cannot import
 * from `src/lib/batch-d-events.ts` at runtime (different runtime), so
 * it carries a hand-mirrored catalogue. Drift between the two is the
 * #1 risk for the D4c safety contract — this test pins it by reading
 * the helper file as text and verifying, for every event in the D4c
 * initiator allowlist, that the helper's mirrored fields match the
 * canonical TS catalogue exactly:
 *
 *   - label
 *   - safeWording
 *   - allowedRecipients (set equality)
 *   - forbiddenRecipients (set equality)
 *
 * Also enforces the corrected D4c-2 invariant: every event in the
 * helper allowlist MUST permit `initiating_org_admin` (otherwise it
 * would be refused at runtime — the bug this test was created to catch).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BATCH_D_EVENTS, getBatchDEvent } from "@/lib/batch-d-events";

const HELPER_PATH = resolve(
  process.cwd(),
  "supabase/functions/_shared/batch-d-initiator-notify.ts",
);
const HELPER_SRC = readFileSync(HELPER_PATH, "utf8");

const D4C_INITIATOR_EVENTS = [
  "engagement.binding_review_required",
  "engagement.binding_review_resolved",
  "engagement.disputed_being_named",
  "engagement.cancelled_email_change",
  "engagement.late_acceptance_pending_reconfirmation",
] as const;

/** Extract the object literal block in the helper for a given event. */
function extractHelperBlock(event: string): string {
  const marker = `event: "${event}"`;
  const idx = HELPER_SRC.indexOf(marker);
  if (idx === -1) {
    throw new Error(`event ${event} not found in helper mirror`);
  }
  // Find enclosing braces.
  const start = HELPER_SRC.lastIndexOf("{", idx);
  let depth = 0;
  for (let i = start; i < HELPER_SRC.length; i++) {
    const ch = HELPER_SRC[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return HELPER_SRC.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated helper block for ${event}`);
}

function extractStringField(block: string, field: string): string {
  // Match `field: "..."` allowing escaped quotes inside.
  const re = new RegExp(`${field}\\s*:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`);
  const m = block.match(re);
  if (!m) throw new Error(`field ${field} not found in helper block`);
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function extractStringArray(block: string, field: string): string[] {
  const re = new RegExp(`${field}\\s*:\\s*\\[([^\\]]*)\\]`);
  const m = block.match(re);
  if (!m) throw new Error(`field ${field} not found in helper block`);
  const inner = m[1];
  const items: string[] = [];
  const itemRe = /"([^"]+)"/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(inner)) !== null) items.push(im[1]);
  return items;
}

describe("D4c-2 helper ↔ catalogue parity", () => {
  for (const eventName of D4C_INITIATOR_EVENTS) {
    describe(eventName, () => {
      const src = getBatchDEvent(eventName);

      it("exists in the canonical TS catalogue", () => {
        expect(src, `missing source entry for ${eventName}`).toBeDefined();
      });

      it("exists in the Deno helper mirror", () => {
        expect(() => extractHelperBlock(eventName)).not.toThrow();
      });

      it("permits initiating_org_admin (corrected D4c-2 invariant)", () => {
        // The bug this test exists to prevent: an event in the D4c
        // initiator allowlist that does NOT permit initiating_org_admin
        // would always be refused at runtime by the helper's
        // `allowedRecipients.includes("initiating_org_admin")` gate.
        expect(src!.allowedRecipients).toContain("initiating_org_admin");
        expect(src!.forbiddenRecipients).not.toContain("initiating_org_admin");
      });

      it("label matches the helper mirror", () => {
        const block = extractHelperBlock(eventName);
        expect(extractStringField(block, "label")).toBe(src!.label);
      });

      it("safeWording matches the helper mirror", () => {
        const block = extractHelperBlock(eventName);
        expect(extractStringField(block, "safeWording")).toBe(src!.safeWording);
      });

      it("allowedRecipients matches the helper mirror (set equality)", () => {
        const block = extractHelperBlock(eventName);
        const helperSet = new Set(extractStringArray(block, "allowedRecipients"));
        const srcSet = new Set(src!.allowedRecipients);
        expect(helperSet).toEqual(srcSet);
      });

      it("forbiddenRecipients matches the helper mirror (set equality)", () => {
        const block = extractHelperBlock(eventName);
        const helperSet = new Set(
          extractStringArray(block, "forbiddenRecipients"),
        );
        const srcSet = new Set(src!.forbiddenRecipients);
        expect(helperSet).toEqual(srcSet);
      });
    });
  }

  it("helper allowlist length matches the agreed five D4c initiator events", () => {
    // Scan helper for `event: "..."` occurrences inside the catalogue
    // array. The mirror must contain exactly the five D4c events.
    const found = Array.from(
      HELPER_SRC.matchAll(/event:\s*"([^"]+)"/g),
      (m) => m[1],
    );
    expect(found.sort()).toEqual([...D4C_INITIATOR_EVENTS].sort());
  });

  it("D4b admin-dispatch events that also receive initiator notices keep platform_admin allowed", () => {
    // Defence-in-depth: an event flipped to adminDispatchEnabled=true
    // must still include platform_admin in its allowedRecipients, even
    // after the D4c-2 widening.
    for (const e of BATCH_D_EVENTS) {
      if (e.adminDispatchEnabled) {
        expect(e.allowedRecipients).toContain("platform_admin");
      }
    }
  });
});
