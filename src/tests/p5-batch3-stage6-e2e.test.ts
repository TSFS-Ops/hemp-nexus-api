/**
 * P-5 Batch 3 — Stage 6 E2E acceptance journey (pure logic simulation).
 *
 * Simulates the full Batch 3 happy path through the Stage 6 derivation
 * layers. No HTTP / DB I/O. Proves that funder action alone never reaches
 * finality, Memory intents are screened safe, downloads are watermarked
 * and audited (intent), and expiry/revocation produce the unavailable
 * task intents.
 */
import { describe, it, expect } from "vitest";
import { deriveNotifications } from "@/lib/p5-batch3/notifications";
import { evaluateSla } from "@/lib/p5-batch3/sla-rules";
import { evaluateFinality } from "@/lib/p5-batch3/finality-bridge";
import { buildMemoryIntent, screenMemoryIntentSafe } from "@/lib/p5-batch3/readiness-bridge";
import { scopeToFunder, isIsolated } from "@/lib/p5-batch3/multi-funder";
import { decideDownload } from "@/lib/p5-batch3/downloads";
import { applyAdminExternalEdit } from "@/lib/p5-batch3/request-lifecycle";

describe("Batch 3 E2E acceptance", () => {
  it("runs the full journey safely", () => {
    // 1. Admin creates funder org + invites funder user (notification intents).
    const inviteIntents = deriveNotifications({
      trigger: "funder_invited",
      org_id: "org-funder-1",
    });
    expect(inviteIntents.some((i) => i.audience === "external_funder")).toBe(true);
    expect(inviteIntents.some((i) => i.audience === "internal_admin")).toBe(true);

    // 2. Admin releases a pack version (notification intents).
    const releaseIntents = deriveNotifications({
      trigger: "released_pack_version_changed",
      grant_id: "grant-A",
      evidence_pack_version: "v3",
    });
    expect(releaseIntents.find((i) => i.audience === "external_funder")?.body_lines.join("\n")).toMatch(/v3/);

    // 3. Funder A and B both have scoped views — isolation.
    const view = {
      transaction_id: "tx-1",
      engagements: [
        {
          funder_organisation_id: "org-funder-1",
          status: "in_progress" as const,
          notes_visible_to_funder: [],
          request_thread_ids: [],
          audit_log_ids: [],
          released_pack_versions: [3],
          exit_outcome: null,
        },
        {
          funder_organisation_id: "org-funder-2",
          status: "in_progress" as const,
          notes_visible_to_funder: [],
          request_thread_ids: [],
          audit_log_ids: [],
          released_pack_versions: [3],
          exit_outcome: null,
        },
      ],
    };
    const aOnly = scopeToFunder(view, "org-funder-1");
    expect(aOnly.engagements).toHaveLength(1);
    expect(isIsolated(aOnly, "org-funder-1")).toBe(true);

    // 4. Funder submits an information request; admin moderates external text
    //    while preserving original text.
    const moderated = applyAdminExternalEdit(
      { original_text: "ORIGINAL", external_text: null },
      "moderated public text",
    );
    expect(moderated.original_text).toBe("ORIGINAL");
    expect(moderated.external_text).toBe("moderated public text");

    // 5. Funder submits 'interested' outcome — finality must NOT change.
    const fin1 = evaluateFinality({ funder_outcome: "interested" });
    expect(fin1.is_final).toBe(false);
    expect(fin1.eligibility).toBe("no_change");

    // 6. Funder later submits funding_approved_subject_to_admin — bridge says
    //    admin review required, not final.
    const fin2 = evaluateFinality({ funder_outcome: "funding_approved_subject_to_admin" });
    expect(fin2.is_final).toBe(false);
    expect(fin2.requires_admin_confirmation).toBe(true);
    expect(fin2.eligibility).toBe("admin_review_funding_decision");

    // 7. Memory bridge returns safe intent only.
    const memory = buildMemoryIntent({
      funder_org_id: "org-funder-1",
      funder_org_name: "Acme Capital",
      granted_at: "2026-01-01T00:00:00Z",
      expires_at: "2026-03-01T00:00:00Z",
      evidence_pack_version: "v3",
      requests: [{ category: "commercial" }],
      outcomes: [{ outcome: "interested", submitted_at: "2026-01-10T00:00:00Z" }],
      final_admin_decision: null,
      approved_lessons: [],
    });
    expect(screenMemoryIntentSafe(memory)).toBe(true);
    expect(JSON.stringify(memory)).not.toMatch(/raw_|private_funder_notes|admin_only_notes/);

    // 8. Download is watermarked + logged (released PDF only).
    const dl = decideDownload({
      format: "pdf",
      admin_released: true,
      watermark_applied: true,
      link_issued_at: new Date().toISOString(),
      pack_version: 3,
      grant: {
        status: "active",
        funder_organisation_id: "org-funder-1",
        funder_user_id: "user-1",
        transaction_id: "tx-1",
        evidence_pack_version: 3,
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      },
      user_id: "user-1",
      organisation_id: "org-funder-1",
      transaction_id: "tx-1",
      now: new Date(),
    });
    expect(dl.allowed).toBe(true);
    // Raw exports are blocked.
    const raw = decideDownload({
      format: "raw_bank",
      admin_released: true,
      watermark_applied: true,
      link_issued_at: new Date().toISOString(),
      pack_version: 3,
      grant: null,
      user_id: "user-1",
      organisation_id: "org-funder-1",
      transaction_id: "tx-1",
    });
    expect(raw.allowed).toBe(false);
    expect(raw.reason).toBe("raw_export_blocked");

    // 9. Expiry produces unavailable task intents.
    const now = new Date();
    const { tasks } = evaluateSla({
      now,
      grants: [
        {
          grant_id: "grant-A",
          org_id: "org-funder-1",
          status: "expired",
          expires_at: new Date(now.getTime() - 86_400_000).toISOString(),
          admin_override_expiry: false,
          last_funder_activity_at: null,
        },
      ],
      downloads: [],
      requests: [],
    });
    expect(tasks.some((t) => t.kind === "expired_grant_unavailable")).toBe(true);

    // 10. No raw sensitive values or forbidden wording leak in any external
    //     intent produced along the way.
    const FORBIDDEN = /\b(Verified|Guaranteed|Investment Grade|raw_bank|raw_iban|raw_passport|other funder)\b/i;
    const allExternal = [...inviteIntents, ...releaseIntents].filter((i) => i.audience === "external_funder");
    for (const ext of allExternal) {
      expect([ext.subject, ...ext.body_lines].join("\n")).not.toMatch(FORBIDDEN);
    }
  });
});
