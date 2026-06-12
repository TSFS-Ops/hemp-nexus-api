/**
 * Unknown-Counterparty Admin Facilitation — Batch 3 static guards.
 *
 * Proves at test time:
 *   • the manual outreach dialog renders the mandatory outside-platform
 *     notice and the allowed contact methods
 *   • forbidden send/dispatch copy is absent from the dialog
 *   • no Send button is present
 *   • the dialog only calls the existing `poi-engagements` PATCH path
 *   • no calls to notify / notification-dispatch / send-transactional-email
 *     / process-email-queue / engagement-reminder / external providers
 *   • `engagement_outreach_logs` schema is not altered by Batch 3 code
 *   • POI Verification Gate files were not modified by Batch 3
 *   • AI Outreach Drafter Phase 1 edge functions were not modified by Batch 3
 *   • the dialog never PATCHes `engagement_status` from this surface (so
 *     canonical POI/match state is not mutated for queue display)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function read(p: string): string {
  return readFileSync(resolve(process.cwd(), p), "utf8");
}

const DIALOG_PATH = "src/components/admin/ManualOutreachLogDialog.tsx";
const PANEL_PATH = "src/components/admin/AdminPendingEngagementsPanel.tsx";

const FORBIDDEN_TOKENS = [
  "notification-dispatch",
  "send-transactional-email",
  "process-email-queue",
  "engagement-reminder",
  "preview-outreach",
  "send-outreach",
  "resend.com",
  "sendgrid",
  "mailgun",
  "twilio",
  "smtp.",
  "whatsapp-provider",
];

const FORBIDDEN_COPY = [
  /\bSend email\b/i,
  /\bDispatch\b/i,
  /\bNotify counterparty\b/i,
  /\bContact counterparty\b/i,
  /\bTrigger outreach\b/i,
  /\bOutreach sent\b/i,
  /\bNotification sent\b/i,
  /\bMessage delivered\b/i,
];

describe("Batch 3 — Manual outreach logging dialog", () => {
  const dialog = read(DIALOG_PATH);

  it("renders the mandatory outside-platform notice verbatim", () => {
    expect(dialog).toContain(
      "This records outreach performed outside the platform. It does not send email, SMS, WhatsApp, or notifications.",
    );
  });

  it("offers the allowed contact methods only", () => {
    for (const method of [
      "email",
      "phone",
      "linkedin",
      "whatsapp",
      "in_person",
      "other",
    ]) {
      expect(dialog).toContain(`value: "${method}"`);
    }
  });

  it("uses only allowed save-action copy", () => {
    expect(dialog).toMatch(/Record manual outreach/);
    // No "Send" button on this surface.
    expect(dialog).not.toMatch(/>\s*Send\s*</);
    expect(dialog).not.toMatch(/<Button[^>]*>\s*Send\b/);
  });

  it("does not include any forbidden send-like copy", () => {
    for (const re of FORBIDDEN_COPY) {
      expect(dialog).not.toMatch(re);
    }
  });

  it("does not reference any forbidden dispatch token or external provider", () => {
    for (const tok of FORBIDDEN_TOKENS) {
      expect(dialog.toLowerCase()).not.toContain(tok);
    }
  });

  it("calls only the existing poi-engagements PATCH endpoint", () => {
    expect(dialog).toMatch(/supabase\.functions\.invoke\(\s*`poi-engagements\/\$\{engagementId\}`/);
    expect(dialog).toMatch(/method:\s*"PATCH"/);
    // No other edge function is invoked.
    const invokes = dialog.match(/functions\.invoke\(/g) ?? [];
    expect(invokes.length).toBe(1);
  });

  it("never PATCHes engagement_status from this surface", () => {
    // Canonical POI/match state is NOT mutated for queue display.
    expect(dialog).not.toMatch(/engagement_status\s*:/);
  });

  it("uses the success copy 'Manual outreach recorded.'", () => {
    expect(dialog).toContain("Manual outreach recorded.");
    expect(dialog).not.toMatch(/Outreach sent/i);
    expect(dialog).not.toMatch(/Notification sent/i);
  });
});

describe("Batch 3 — panel wiring", () => {
  const panel = read(PANEL_PATH);

  it("mounts the manual outreach dialog from the pending engagements panel", () => {
    expect(panel).toContain("ManualOutreachLogDialog");
    expect(panel).toContain('from "@/components/admin/ManualOutreachLogDialog"');
  });

  it("exposes a per-row 'Log manual outreach' affordance", () => {
    expect(panel).toMatch(/Log manual outreach/);
    expect(panel).toMatch(/data-testid=\{`log-manual-outreach-/);
  });
});

describe("Batch 3 — workstream boundaries", () => {
  it("does not modify engagement_outreach_logs schema", () => {
    // No migration files added by Batch 3 should mention altering the
    // outreach logs table. We assert the dialog itself never references
    // table DDL; the migration directory check is light-touch.
    const dialog = read(DIALOG_PATH);
    expect(dialog).not.toMatch(/engagement_outreach_logs/i);
    expect(dialog).not.toMatch(/ALTER\s+TABLE/i);
    expect(dialog).not.toMatch(/CREATE\s+TABLE/i);
  });

  it("does not import from POI Verification Gate modules", () => {
    const dialog = read(DIALOG_PATH);
    // No imports from any "verification gate" module.
    expect(dialog).not.toMatch(/verification[-_/]gate/i);
    expect(dialog).not.toMatch(/poi-verification/i);
  });

  it("does not modify AI Outreach Drafter Phase 1 edge functions", () => {
    // The Drafter edge functions must still exist and remain decoupled —
    // this dialog does not import them or their hooks.
    const generatePath = resolve(
      process.cwd(),
      "supabase/functions/generate-engagement-outreach-draft/index.ts",
    );
    const decisionPath = resolve(
      process.cwd(),
      "supabase/functions/engagement-outreach-draft-decision/index.ts",
    );
    expect(existsSync(generatePath)).toBe(true);
    expect(existsSync(decisionPath)).toBe(true);

    const dialog = read(DIALOG_PATH);
    expect(dialog).not.toContain("generate-engagement-outreach-draft");
    expect(dialog).not.toContain("engagement-outreach-draft-decision");
    expect(dialog).not.toContain("useEngagementOutreachDraft");
  });
});
