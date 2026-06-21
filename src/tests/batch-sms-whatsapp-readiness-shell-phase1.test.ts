/**
 * Phase 1 — SMS / WhatsApp Notification Readiness Shell
 *
 * Static contract suite. Runtime gating is enforced by RLS + DB triggers
 * (see Phase 1 migration). These tests pin the SSOT, the safe labels, the
 * skip-reason vocabulary, the event→channel matrix, the absence of any
 * live SMS/WhatsApp provider integration, and the role gates on manual
 * outreach logging.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

const ssotTs = read("src/lib/notification-channel-readiness.ts");
const ssotDeno = read("supabase/functions/_shared/notification-channel-readiness.ts");
const skipFn = read("supabase/functions/notification-channel-skip-record/index.ts");
const manualFn = read("supabase/functions/manual-outreach-contact-log/index.ts");
const updateFn = read("supabase/functions/notification-channel-readiness-update/index.ts");
const listFn = read("supabase/functions/notification-channel-readiness-list/index.ts");
const adminPage = read("src/pages/admin/notifications/ChannelReadiness.tsx");

describe("Phase 1 — channel readiness SSOT", () => {
  it("declares the four canonical channels", () => {
    for (const c of ["in_app", "email", "sms", "whatsapp"]) {
      expect(ssotTs).toMatch(new RegExp(`"${c}"`));
      expect(ssotDeno).toMatch(new RegExp(`"${c}"`));
    }
  });

  it("locks sms + whatsapp in Phase 1", () => {
    expect(ssotTs).toMatch(/PHASE_1_LOCKED_CHANNELS[\s\S]*"sms"[\s\S]*"whatsapp"/);
  });

  it("declares all 8 recognised skip reasons", () => {
    const reasons = [
      "notification_skipped_provider_not_configured",
      "notification_provider_unavailable",
      "notification_template_not_approved",
      "notification_phone_missing_or_invalid",
      "notification_delivery_failed",
      "notification_suppressed_opt_out",
      "notification_channel_disabled",
      "notification_not_in_phase_1",
    ];
    for (const r of reasons) {
      expect(ssotTs).toContain(`"${r}"`);
      expect(ssotDeno).toContain(`"${r}"`);
    }
  });

  it("publishes the canonical safe labels", () => {
    expect(ssotTs).toContain("SMS/WhatsApp is not configured. No external message was sent.");
    expect(ssotTs).toContain("This channel is disabled by Izenzo. No external message was sent.");
    expect(ssotTs).toContain("Provider credentials are missing. No external message was sent.");
    expect(ssotTs).toContain("Message template is not approved. No external message was sent.");
    expect(ssotTs).toContain("Izenzo logged manual contact outside the platform. This is not a system-sent message.");
  });
});

describe("Phase 1 — event channel matrix", () => {
  it("disallows SMS and WhatsApp system-sends for every listed event", () => {
    expect(ssotTs).toMatch(/sms_system_send:\s*false/);
    expect(ssotTs).toMatch(/whatsapp_system_send:\s*false/);
    // No `sms_system_send: true` anywhere
    expect(ssotTs).not.toMatch(/sms_system_send:\s*true/);
    expect(ssotTs).not.toMatch(/whatsapp_system_send:\s*true/);
  });

  it("allows manual log only on unknown-counterparty facilitation alert", () => {
    const rows = ssotTs.match(/{ event: "[^"]+",[\s\S]*?manual_sms_whatsapp_log_allowed:\s*(true|false)[\s\S]*?}/g) ?? [];
    const allowed = rows.filter((r) => /manual_sms_whatsapp_log_allowed:\s*true/.test(r));
    expect(allowed.length).toBe(1);
    expect(allowed[0]).toContain("unknown_cp_facilitation_alert");
  });
});

describe("Phase 1 — no live provider integration", () => {
  const forbidden = [
    "twilio", "messagebird", "vonage", "plivo", "africastalking",
    "infobip", "whatsapp-business", "whatsapp-cloud",
    "TWILIO_ACCOUNT_SID", "WHATSAPP_API_TOKEN",
  ];
  it("no live SMS/WhatsApp SDK or credential references in Phase 1 files", () => {
    const all = ssotTs + ssotDeno + skipFn + manualFn + updateFn + listFn + adminPage;
    for (const tok of forbidden) {
      expect(all.toLowerCase()).not.toContain(tok.toLowerCase());
    }
  });

  it("never emits a fetch to an SMS or WhatsApp provider host", () => {
    for (const f of [skipFn, manualFn, updateFn, listFn]) {
      expect(f).not.toMatch(/fetch\([^)]*twilio/i);
      expect(f).not.toMatch(/fetch\([^)]*whatsapp/i);
      expect(f).not.toMatch(/fetch\([^)]*graph\.facebook/i);
    }
  });

  it("no test-send button or endpoint exists on the admin page", () => {
    expect(adminPage.toLowerCase()).not.toMatch(/send test (sms|whatsapp)/);
    expect(adminPage.toLowerCase()).not.toMatch(/test send button/);
  });
});

describe("Phase 1 — readiness update endpoint hard guards", () => {
  it("rejects any client attempt to enable live sending / test send / credentials / webhook", () => {
    expect(updateFn).toMatch(/phase_1_locked/);
    expect(updateFn).toMatch(/live_sending_enabled/);
    expect(updateFn).toMatch(/test_send_enabled/);
    expect(updateFn).toMatch(/credentials_status/);
    expect(updateFn).toMatch(/webhook_status/);
  });

  it("requires platform_admin role to mutate", () => {
    expect(updateFn).toMatch(/platform_admin/);
  });
});

describe("Phase 1 — skip recorder", () => {
  it("validates reason against the SSOT list", () => {
    expect(skipFn).toMatch(/NOTIFICATION_SKIP_REASONS/);
  });
  it("rejects raw phone numbers via looksLikeRawPhone", () => {
    expect(skipFn).toMatch(/looksLikeRawPhone/);
  });
  it("records provider_message_id as not_applicable in Phase 1", () => {
    expect(skipFn).toContain('"not_applicable"');
  });
  it("emits notification_channel_skip_recorded audit event", () => {
    expect(skipFn).toContain("notification_channel_skip_recorded");
  });
});

describe("Phase 1 — manual outreach contact log", () => {
  it("restricts roles to platform_admin and support_admin", () => {
    expect(manualFn).toMatch(/MANUAL_OUTREACH_AUTHORISED_ROLES/);
    expect(manualFn).toMatch(/platform_admin/);
    expect(manualFn).toMatch(/support_admin/);
  });

  it("requester / trader / counterparty roles cannot create logs", () => {
    // Authorised list is closed — no other role is mentioned as creator
    expect(manualFn).not.toMatch(/role === "(buyer|seller|requester|trader|counterparty|org_member)"/);
  });

  it("always stores the canonical safe label", () => {
    expect(manualFn).toContain(
      "Izenzo logged manual contact outside the platform. This is not a system-sent message.",
    );
  });

  it("masks the phone before insert", () => {
    expect(manualFn).toMatch(/maskPhone\(/);
    expect(manualFn).toMatch(/looksLikeRawPhone\(/);
  });

  it("emits manual_outreach_logged audit", () => {
    expect(manualFn).toContain("manual_outreach_logged");
  });

  it("emits unknown_counterparty_engagement_confirmed when engagement_complete=true", () => {
    expect(manualFn).toContain("unknown_counterparty_engagement_confirmed");
    expect(manualFn).toMatch(/if\s*\(\s*engagement_complete\s*\)/);
  });

  it("only accepts unknown_counterparty_facilitation cases (DB CHECK)", () => {
    // DB-side gate covered by migration; assert client-side does not bypass.
    expect(manualFn).not.toMatch(/case_type:\s*['"](?!unknown_counterparty_facilitation)/);
  });
});

describe("Phase 1 — POI / WaD progression gates are NOT unlocked by notification status", () => {
  it("Phase 1 SSOT does not export any function named *unlockFrom(Notification|Skipped|Sent|Delivered)*", () => {
    expect(ssotTs).not.toMatch(/unlockFrom(Notification|Skipped|Sent|Delivered)/i);
  });
  it("Phase 1 SSOT carries no helper to mark a skipped notification as 'delivered' for SMS/WhatsApp", () => {
    expect(ssotTs).not.toMatch(/(sms|whatsapp)[^a-z0-9]*delivered/i);
    expect(ssotTs).not.toMatch(/(sms|whatsapp)[^a-z0-9]*sent/i);
  });
});

describe("Phase 1 — admin readiness page", () => {
  it("renders SMS and WhatsApp cards", () => {
    expect(adminPage).toMatch(/data-testid=\{`channel-card-\$\{r\.channel\}`\}/);
  });
  it("shows the canonical safe label banner via the SSOT constant", () => {
    expect(adminPage).toMatch(/NOTIFICATION_SAFE_LABELS\.not_configured/);
  });
  it("renders the Phase 1 event matrix and skip reasons", () => {
    expect(adminPage).toMatch(/Phase 1 event → channel matrix/);
    expect(adminPage).toMatch(/Recognised skip reasons/);
  });
  it("does not expose a 'live send' or 'test send' action control", () => {
    // Status labels like <dt>Test send</dt> are allowed because they show "disabled".
    // What is forbidden is any clickable control that would actually trigger a send.
    expect(adminPage).not.toMatch(/onClick=\{[^}]*sendLive/i);
    expect(adminPage).not.toMatch(/onClick=\{[^}]*sendTest/i);
    expect(adminPage).not.toMatch(/<Button[^>]*>\s*(Send live|Send test|Run test send)/i);
  });
});

describe("Phase 1 — audit event vocabulary", () => {
  it("declares the five Phase 1 audit event names", () => {
    for (const name of [
      "notification_channel_readiness_viewed",
      "notification_channel_readiness_label_updated",
      "notification_channel_skip_recorded",
      "manual_outreach_logged",
      "unknown_counterparty_engagement_confirmed",
    ]) {
      expect(ssotTs).toContain(`"${name}"`);
      expect(ssotDeno).toContain(`"${name}"`);
    }
  });
});

describe("Phase 1 — phone masking helper", () => {
  it("masks an E.164 number to head + tail", async () => {
    const mod = await import("@/lib/notification-channel-readiness");
    expect(mod.maskPhone("+27821234567")).toMatch(/^\+27\*{3,}567$/);
    expect(mod.looksLikeRawPhone("+27821234567")).toBe(true);
    expect(mod.looksLikeRawPhone("+27******567")).toBe(false);
  });
});
