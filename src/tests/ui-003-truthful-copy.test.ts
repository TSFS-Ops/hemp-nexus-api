/**
 * UI-003 — Truthful queued-vs-sent copy contract.
 *
 * Source-pin tests that read the actual files and assert wording. The
 * underlying email/queue behaviour is unchanged; only user-facing and
 * audit-snapshot strings were corrected so that "sent" is reserved for
 * confirmed provider delivery.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getEngagementWording } from "@/lib/engagement-wording";

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const adminPanel = read("src/components/admin/AdminPendingEngagementsPanel.tsx");
const unknownStatus = read("src/components/match/UnknownCounterpartyStatus.tsx");
const wordingSrc = read("src/lib/engagement-wording.ts");
const forensics = read("src/components/admin/AdminEngagementForensicsPanel.tsx");
const poiEdge = read("supabase/functions/poi-engagements/index.ts");

describe("UI-003 — truthful copy after enqueue", () => {
  it("1. admin send-notification toast does NOT use 'sent'", () => {
    expect(adminPanel).not.toMatch(/toast\.success\(`Notification sent to/);
  });

  it("2. admin send-notification toast uses 'queued'", () => {
    expect(adminPanel).toMatch(/Outreach email queued for \$\{[^}]+\}\. Delivery status will appear in the email log\./);
  });

  it("2b. admin send-outreach toast uses 'queued', not 'Email sent'", () => {
    expect(adminPanel).not.toMatch(/toast\.success\(`Email sent to/);
    expect(adminPanel).toMatch(/Outreach email queued for \$\{[^}]+\}\./);
  });

  it("3. UnknownCounterpartyStatus does NOT render 'Outreach email sent'", () => {
    expect(unknownStatus).not.toMatch(/"Outreach email sent"/);
  });

  it("4. UnknownCounterpartyStatus renders 'Outreach email queued'", () => {
    expect(unknownStatus).toMatch(/"Outreach email queued"/);
    expect(unknownStatus).toMatch(/An outreach email was queued for delivery/);
    // Sub-badge should also use queued language.
    expect(unknownStatus).toMatch(/Outreach queued — awaiting signup/);
  });

  it("5. engagement-wording 'contacted' label does NOT contain 'sent'", () => {
    const w = getEngagementWording({ status: "contacted" });
    expect(w.badgeLabel.toLowerCase()).not.toContain("sent");
  });

  it("6. engagement-wording 'contacted' label contains 'queued'", () => {
    const w = getEngagementWording({ status: "contacted" });
    expect(w.badgeLabel.toLowerCase()).toContain("queued");
  });

  it("7+8. admin KPI for notification_sent uses 'Awaiting outreach', not 'Notified'", () => {
    // KPI block: stats.notified rendered with the label "Awaiting outreach".
    expect(adminPanel).toMatch(/label:\s*"Awaiting outreach",\s*value:\s*stats\.notified/);
    // The user-visible label "Notified" must not be rendered as a KPI.
    expect(adminPanel).not.toMatch(/label:\s*"Notified"/);
  });

  it("9. server-side outreach audit snapshot uses 'EMAIL QUEUED', not 'EMAIL SENT'", () => {
    expect(poiEdge).toMatch(/`EMAIL QUEUED to \$\{recipient\}`/);
    expect(poiEdge).not.toMatch(/`EMAIL SENT to \$\{recipient\}`/);
  });

  it("10. forensics panel does not render raw 'notification_sent' as the primary badge label", () => {
    // Primary badge now uses the wording-engine label, raw status is shown
    // separately as a small mono caption.
    expect(forensics).toMatch(/getEngagementWording\(\{\s*status:\s*r\.engagement_status\s*\}\)\.badgeLabel/);
    expect(forensics).toMatch(/Raw status:/);
    // The old raw-only render must be gone.
    expect(forensics).not.toMatch(/<Badge variant=\{statusVariant\(r\.engagement_status\) as never\}>\{r\.engagement_status\}<\/Badge>/);
  });

  it("11. no-recipient copy in UnknownCounterpartyStatus remains clear and unchanged", () => {
    expect(unknownStatus).toContain(
      "Awaiting confirmation of your counterparty's email address before outreach can be sent.",
    );
  });

  it("12. suppression / no-recipient copy in admin panel remains clear", () => {
    // Pre-existing helper copy that was NOT in scope must remain.
    expect(adminPanel).toContain(
      "Email saved but no registered organisation matches it yet.",
    );
  });

  it("regression: wording-engine source still defines a 'contacted' branch", () => {
    expect(wordingSrc).toMatch(/case "contacted":/);
  });
});
