/**
 * Batch D — D4b wording guard for composed admin alerts.
 *
 * Verifies that the subject + body strings the helper composes from
 * the catalogue's safeWording (mirrored in the Deno helper) pass the
 * forbidden-word guard and respect the 200-char subject ceiling.
 *
 * Composition rule the helper follows:
 *   subject  = `[Izenzo Admin] <label phrase>` [ + ` (N pending)` for digest ]
 *   body     = `<safeWording>\n\nEngagement: <id>\nQueue: /admin/pending-engagements`
 */

import { describe, it, expect } from "vitest";
import {
  BATCH_D_EVENTS,
  findForbiddenWords,
} from "@/lib/batch-d-events";

const SUBJECT_MAX = 200;
const FAKE_ID = "00000000-0000-4000-8000-000000000001";

const D4B_SUBJECTS: Record<string, string> = {
  "engagement.binding_review_required": "[Izenzo Admin] Binding review required",
  "engagement.disputed_being_named": "[Izenzo Admin] Counterparty dispute received",
};

describe("Batch D — D4b composed wording guard", () => {
  it("subjects + bodies for flipped events contain no forbidden tokens", () => {
    for (const e of BATCH_D_EVENTS) {
      if (!e.adminDispatchEnabled) continue;
      const subject = D4B_SUBJECTS[e.event];
      expect(subject, `${e.event} missing subject mapping`).toBeDefined();
      const body = `${e.safeWording}\n\nEngagement: ${FAKE_ID}\nQueue: /admin/pending-engagements`;
      expect(findForbiddenWords(subject)).toEqual([]);
      expect(findForbiddenWords(body)).toEqual([]);
    }
  });

  it("subjects (including digest variant) stay within 200 characters", () => {
    for (const e of BATCH_D_EVENTS) {
      if (!e.adminDispatchEnabled) continue;
      const base = D4B_SUBJECTS[e.event];
      const digest = `${base} (999 pending)`;
      expect(base.length).toBeLessThanOrEqual(SUBJECT_MAX);
      expect(digest.length).toBeLessThanOrEqual(SUBJECT_MAX);
    }
  });

  it("body never interpolates commodity / org name / contact name", () => {
    // The helper's body template is a fixed format. This test pins the
    // shape: only the catalogue safeWording + a hard-coded engagement id
    // line + a queue link. Any change to add free-text fields to the
    // body must update this test (and re-run the wording guard).
    for (const e of BATCH_D_EVENTS) {
      if (!e.adminDispatchEnabled) continue;
      const body = `${e.safeWording}\n\nEngagement: ${FAKE_ID}\nQueue: /admin/pending-engagements`;
      expect(body).not.toMatch(/commodity/i);
      expect(body).not.toMatch(/organisation:|org name|contact name/i);
    }
  });
});
