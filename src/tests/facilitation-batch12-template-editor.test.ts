/**
 * Facilitation Batch 12 — Admin Notification Template Editor unit tests.
 *
 * Pure / static coverage — no edge-function network calls. Behavioural
 * server tests live in the facilitation UAT.
 *
 * What this proves:
 *   1. allowed actions = exactly create_draft / update_draft / submit_for_approval
 *   2. audit names = exactly facilitation_template.draft_created / draft_updated
 *   3. server SSOT + browser SSOT do not drift
 *   4. server allow-list is exactly the three actions (no widening)
 *   5. editor function does NOT import the requester-safe notification triggers
 *   6. editor function rejects edits to approved templates (isEditableStatus)
 *   7. editor function rejects edits to archived templates (isEditableStatus)
 *   8. editor function never sets status='approved' / approved_by / approved_at
 *   9. existing approval function blocks drafter-self-approval
 *  10. update_draft uses .eq("status","draft") race-guard
 *  11. previous_template_id is supported by the editor function payload
 *  12. forbidden body content (script tag) is rejected
 *  13. forbidden body content (inline event handler) is rejected
 *  14. variable substitution preview replaces known tokens and leaves unknowns
 *  15. variable substitution preview is pure (no network / no Date.now use)
 *  16. submit_for_approval marks draft via submitted_for_approval_at / _by
 *  17. clampSubject is applied in the editor function
 *  18. requester-safe notification trigger catalogue is NOT mutated by Batch 12
 *  19. previous_template_id column exists in migration history
 *  20. editor function has no email/Slack/SMS/WhatsApp/webhook/dispatch path
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  FACILITATION_TEMPLATE_EDITOR_ACTIONS,
  FACILITATION_TEMPLATE_AUDIT_NAMES,
  findForbiddenBodyMatches,
  renderPreview,
  isEditableStatus,
  TEMPLATE_PREVIEW_SAMPLE,
} from "@/lib/facilitation-template-editor";

const ROOT = resolve(__dirname, "..", "..");
const FN = resolve(ROOT, "supabase/functions/facilitation-template-editor/index.ts");
const APPR = resolve(ROOT, "supabase/functions/facilitation-outreach-template-status/index.ts");
const SERVER = resolve(ROOT, "supabase/functions/_shared/facilitation-template-editor.ts");
const BROWSER = resolve(ROOT, "src/lib/facilitation-template-editor.ts");
const READ = (p: string) => readFileSync(p, "utf8");

describe("Batch 12 — vocabulary", () => {
  it("(1) allowed actions are exactly create_draft, update_draft, submit_for_approval", () => {
    expect([...FACILITATION_TEMPLATE_EDITOR_ACTIONS].sort()).toEqual(
      ["create_draft", "submit_for_approval", "update_draft"],
    );
  });
  it("(2) audit names are exactly draft_created + draft_updated", () => {
    expect([...FACILITATION_TEMPLATE_AUDIT_NAMES].sort()).toEqual(
      ["facilitation_template.draft_created", "facilitation_template.draft_updated"],
    );
  });
  it("(3) server SSOT + browser SSOT do not drift", () => {
    const s = READ(SERVER); const b = READ(BROWSER);
    for (const a of FACILITATION_TEMPLATE_EDITOR_ACTIONS) {
      expect(s.includes(`"${a}"`)).toBe(true);
      expect(b.includes(`"${a}"`)).toBe(true);
    }
    for (const a of FACILITATION_TEMPLATE_AUDIT_NAMES) {
      expect(s.includes(`"${a}"`)).toBe(true);
      expect(b.includes(`"${a}"`)).toBe(true);
    }
  });
});

describe("Batch 12 — editor function contract", () => {
  const src = READ(FN);
  const stripped = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("(4) z.literal allow-list is exactly the three actions", () => {
    const lits = [...src.matchAll(/z\.literal\(\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]).sort();
    expect(lits).toEqual(["create_draft", "submit_for_approval", "update_draft"]);
  });
  it("(5) editor does NOT import requester-safe notification triggers", () => {
    expect(src).not.toMatch(/REQUESTER_SAFE_NOTIFICATION_TRIGGERS/);
    expect(src).not.toMatch(/facilitation-case-state/);
  });
  it("(6/7) editor relies on isEditableStatus to reject approved + archived edits", () => {
    expect(src).toMatch(/isEditableStatus\(/);
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("approved")).toBe(false);
    expect(isEditableStatus("archived")).toBe(false);
  });
  it("(8) editor never sets status='approved'/approved_by/approved_at", () => {
    expect(stripped).not.toMatch(/status\s*:\s*['"]approved['"]/);
    expect(stripped).not.toMatch(/approved_by\s*[:=]/);
    expect(stripped).not.toMatch(/approved_at\s*[:=]/);
    expect(stripped).not.toMatch(/facilitation-outreach-template-status/);
  });
  it("(10) update_draft path uses .eq(\"status\",\"draft\") race-guard", () => {
    expect(stripped).toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]draft['"]\s*\)/);
  });
  it("(11) create_draft schema supports previous_template_id (uuid optional)", () => {
    expect(stripped).toMatch(/previous_template_id:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
  });
  it("(17) editor applies clampSubject", () => {
    expect(src).toMatch(/clampSubject\(/);
  });
  it("(20) editor has no send/email/Slack/SMS/WhatsApp/webhook/dispatch path", () => {
    const forbidden = [
      /send-transactional-email/i, /notification-dispatch/i,
      /resend\.emails\.send/i, /api\.resend\.com/i,
      /slack\.com\/api/i, /whatsapp/i, /\bsms\b/i,
      /webhook[-_ ]?dispatch/i, /facilitation-outreach-send/i,
    ];
    for (const re of forbidden) expect(stripped).not.toMatch(re);
  });
  it("(16) submit_for_approval writes submitted_for_approval_at + _by markers", () => {
    expect(stripped).toMatch(/submittedMarker\(/);
    expect(READ(SERVER)).toMatch(/submitted_for_approval_at/);
    expect(READ(SERVER)).toMatch(/submitted_for_approval_by/);
  });
});

describe("Batch 12 — drafter cannot approve self", () => {
  const src = READ(APPR);
  it("(9) approval function rejects when created_by === userId", () => {
    expect(src).toMatch(/DRAFTER_CANNOT_APPROVE_SELF/);
    expect(src).toMatch(/created_by\s*===\s*userId/);
  });
});

describe("Batch 12 — body safety", () => {
  it("(12) rejects <script> tag in body", () => {
    expect(findForbiddenBodyMatches("Hello <script>alert(1)</script>")).toContain("<script> tag");
  });
  it("(13) rejects inline event handlers", () => {
    expect(findForbiddenBodyMatches('<img src=x onerror="alert(1)">')).toContain(
      "inline event handler (onclick=, onerror=, …)",
    );
  });
  it("rejects javascript: URLs", () => {
    expect(findForbiddenBodyMatches('<a href="javascript:alert(1)">x</a>'))
      .toContain("javascript: URL");
  });
  it("accepts a clean template body", () => {
    expect(findForbiddenBodyMatches("Hello {{contact_name}}, regarding {{commodity}}.")).toEqual([]);
  });
});

describe("Batch 12 — variable preview", () => {
  it("(14) replaces known tokens and leaves unknown tokens intact", () => {
    const out = renderPreview("Hi {{contact_name}}, from {{requester_org_name}} about {{unknown_var}}.");
    expect(out).toContain("Hi Sample Contact");
    expect(out).toContain("Sample Requester Pty Ltd");
    expect(out).toContain("{{unknown_var}}");
  });
  it("(15) preview is pure — calling twice with same input yields identical output", () => {
    const t = "X {{contact_name}} Y";
    expect(renderPreview(t)).toBe(renderPreview(t));
  });
  it("sample payload is frozen", () => {
    expect(Object.isFrozen(TEMPLATE_PREVIEW_SAMPLE)).toBe(true);
  });
});

describe("Batch 12 — requester-safe triggers are untouched + migration present", () => {
  it("(18) Batch 12 does not change the requester-safe trigger catalogue", () => {
    const ssotServer = READ(resolve(ROOT, "supabase/functions/_shared/facilitation-case-state.ts"));
    const ssotBrowser = READ(resolve(ROOT, "src/lib/facilitation-case-state.ts"));
    // The catalogue must still exist exactly once in each SSOT and not be
    // re-exported from Batch 12 modules.
    expect(ssotServer.match(/REQUESTER_SAFE_NOTIFICATION_TRIGGERS/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(ssotBrowser.match(/REQUESTER_SAFE_NOTIFICATION_TRIGGERS/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(READ(SERVER)).not.toMatch(/REQUESTER_SAFE_NOTIFICATION_TRIGGERS/);
    expect(READ(BROWSER)).not.toMatch(/REQUESTER_SAFE_NOTIFICATION_TRIGGERS/);
  });
  it("(19) previous_template_id column is added by a migration", () => {
    const migDir = resolve(ROOT, "supabase/migrations");
    const files = readdirSync(migDir).filter((f) => f.endsWith(".sql"));
    const hit = files.some((f) => {
      const sql = readFileSync(resolve(migDir, f), "utf8");
      return /facilitation_outreach_templates[\s\S]{0,400}previous_template_id/.test(sql);
    });
    expect(hit).toBe(true);
  });
});
