/**
 * P-5 Batch 3 — Stage 6 pure-logic tests.
 */
import { describe, it, expect } from "vitest";
import {
  deriveNotifications,
  isExternalSafe,
  deriveIdempotencyKey,
  P5B3_NOTIFICATION_TRIGGERS,
  type P5B3NotificationIntent,
} from "@/lib/p5-batch3/notifications";
import {
  evaluateSla,
  P5B3_DEFAULT_DOWNLOAD_LINK_TTL_DAYS,
  P5B3_ACCESS_EXPIRING_WARN_DAYS,
} from "@/lib/p5-batch3/sla-rules";
import { evaluateFinality } from "@/lib/p5-batch3/finality-bridge";
import {
  buildMemoryIntent,
  screenMemoryIntentSafe,
} from "@/lib/p5-batch3/readiness-bridge";

describe("notifications: trigger coverage", () => {
  it("declares all 22 required triggers", () => {
    expect(P5B3_NOTIFICATION_TRIGGERS.length).toBe(22);
    for (const t of [
      "funder_invited",
      "access_approved",
      "access_changed",
      "access_expiring",
      "access_revoked",
      "released_pack_available",
      "released_pack_version_changed",
      "admin_replied_request",
      "approved_information_request_answered",
      "request_closed",
      "funder_status_requires_action",
      "finality_reached",
      "transaction_closed",
      "funder_accepted_invitation",
      "funder_viewed_or_downloaded_pack",
      "funder_asked_question",
      "funder_requested_evidence",
      "funder_marked_interested_or_declined",
      "funder_submitted_outcome",
      "funder_uploaded_document",
      "api_usage_unusual_placeholder",
      "request_overdue",
    ] as const) {
      expect(P5B3_NOTIFICATION_TRIGGERS).toContain(t);
    }
  });

  it("emits one internal + (optionally) one external intent per event", () => {
    const out = deriveNotifications({ trigger: "access_approved", grant_id: "g1", transaction_reference: "TX-1" });
    expect(out.find((o) => o.audience === "internal_admin")).toBeTruthy();
    expect(out.find((o) => o.audience === "external_funder")).toBeTruthy();
  });

  it("does NOT emit external for internal-only triggers", () => {
    const out = deriveNotifications({ trigger: "funder_status_requires_action", grant_id: "g1" });
    expect(out.filter((o) => o.audience === "external_funder")).toHaveLength(0);
    const out2 = deriveNotifications({ trigger: "api_usage_unusual_placeholder", grant_id: "g1" });
    expect(out2.filter((o) => o.audience === "external_funder")).toHaveLength(0);
  });

  it("messages funder approval as non-final / not investment advice", () => {
    const out = deriveNotifications({ trigger: "finality_reached", grant_id: "g1" });
    const ext = out.find((o) => o.audience === "external_funder")!;
    expect(ext.body_lines.some((l) => /not constitute investment advice/i.test(l))).toBe(true);
  });

  it("never leaks forbidden wording in external messages", () => {
    for (const trigger of P5B3_NOTIFICATION_TRIGGERS) {
      const out = deriveNotifications({ trigger, grant_id: "g1", transaction_reference: "TX-1", evidence_pack_version: "v1" });
      for (const intent of out) {
        if (intent.audience !== "external_funder") continue;
        const blob = [intent.subject, ...intent.body_lines].join("\n");
        expect(isExternalSafe(blob), `trigger ${trigger} leaked`).toBe(true);
        expect(blob).not.toMatch(/raw_/);
      }
    }
  });

  it("produces stable idempotency keys", () => {
    const a = deriveIdempotencyKey("access_approved", "internal_admin", ["g1", undefined, "TX-1"]);
    const b = deriveIdempotencyKey("access_approved", "internal_admin", ["g1", undefined, "TX-1"]);
    expect(a).toBe(b);
    expect(a).toContain("access_approved");
  });

  it("strips admin-only internal_context from external messages", () => {
    const out = deriveNotifications({
      trigger: "access_approved",
      grant_id: "g1",
      transaction_reference: "TX-1",
      internal_context: "internal note: sensitive risk flag XYZ",
    });
    const ext = out.find((o) => o.audience === "external_funder")!;
    expect(ext.body_lines.join("\n")).not.toMatch(/internal note/i);
    expect(ext.body_lines.join("\n")).not.toMatch(/sensitive risk/i);
  });
});

describe("sla-rules: expiry and overdue", () => {
  const now = new Date("2026-06-01T00:00:00Z");

  it("flags grants within expiry warning window", () => {
    const { tasks, notifications } = evaluateSla({
      now,
      grants: [
        {
          grant_id: "g1",
          org_id: "o1",
          status: "active",
          expires_at: new Date(now.getTime() + 2 * 86_400_000).toISOString(),
          admin_override_expiry: false,
          last_funder_activity_at: null,
        },
      ],
      downloads: [],
      requests: [],
    });
    expect(tasks.some((t) => t.kind === "access_expiring_warning")).toBe(true);
    expect(notifications.some((n) => n.trigger === "access_expiring" && n.audience === "external_funder")).toBe(true);
  });

  it("flags expired download links beyond TTL", () => {
    const { tasks } = evaluateSla({
      now,
      grants: [],
      downloads: [
        {
          download_id: "d1",
          grant_id: "g1",
          issued_at: new Date(now.getTime() - (P5B3_DEFAULT_DOWNLOAD_LINK_TTL_DAYS + 1) * 86_400_000).toISOString(),
        },
      ],
      requests: [],
    });
    expect(tasks.some((t) => t.kind === "download_link_expired")).toBe(true);
  });

  it("flags overdue submitted requests", () => {
    const { tasks, notifications } = evaluateSla({
      now,
      grants: [],
      downloads: [],
      requests: [
        {
          request_id: "r1",
          grant_id: "g1",
          status: "submitted",
          submitted_at: new Date(now.getTime() - 6 * 86_400_000).toISOString(),
          last_admin_action_at: null,
        },
      ],
    });
    expect(tasks.some((t) => t.kind === "request_overdue")).toBe(true);
    expect(notifications.some((n) => n.trigger === "request_overdue")).toBe(true);
  });

  it("flags revoked grants for cleanup with idempotent key", () => {
    const inp = {
      now,
      grants: [
        {
          grant_id: "g1",
          org_id: "o1",
          status: "revoked" as const,
          expires_at: null,
          admin_override_expiry: false,
          last_funder_activity_at: null,
        },
      ],
      downloads: [],
      requests: [],
    };
    const a = evaluateSla(inp);
    const b = evaluateSla(inp);
    expect(a.tasks[0].idempotency_key).toBe(b.tasks[0].idempotency_key);
    expect(a.tasks[0].kind).toBe("revoked_grant_cleanup");
  });

  it("uses correct expiring-warn default", () => {
    expect(P5B3_ACCESS_EXPIRING_WARN_DAYS).toBe(5);
    expect(P5B3_DEFAULT_DOWNLOAD_LINK_TTL_DAYS).toBe(7);
  });
});

describe("finality bridge", () => {
  it("never marks finality from funder action alone", () => {
    const e = evaluateFinality({ funder_outcome: "funding_approved_subject_to_admin" });
    expect(e.is_final).toBe(false);
    expect(e.requires_admin_confirmation).toBe(true);
    expect(e.eligibility).toBe("admin_review_funding_decision");
  });

  it("single decline does not close transaction", () => {
    const e = evaluateFinality({ funder_outcome: "declined" });
    expect(e.eligibility).toBe("no_change");
  });

  it("all-funder decline becomes admin closure candidate", () => {
    const e = evaluateFinality({ all_funder_outcomes: ["declined", "not_interested", "declined"] });
    expect(e.eligibility).toBe("admin_review_all_funders_declined");
    expect(e.is_final).toBe(false);
  });

  it("term sheet becomes admin review eligible", () => {
    expect(evaluateFinality({ funder_outcome: "term_sheet_provided" }).eligibility).toBe("admin_review_term_sheet");
    expect(evaluateFinality({ funder_outcome: "term_sheet_requested" }).eligibility).toBe("admin_review_term_sheet");
  });

  it("interest does not trigger finality", () => {
    expect(evaluateFinality({ funder_outcome: "interested" }).eligibility).toBe("no_change");
  });
});

describe("memory bridge", () => {
  const src = {
    funder_org_id: "org-1",
    funder_org_name: "Acme Capital",
    granted_at: "2026-01-01T00:00:00Z",
    expires_at: "2026-03-01T00:00:00Z",
    evidence_pack_version: "v2",
    requests: [
      { category: "commercial" as const, original_text: "secret raw text" },
      { category: "commercial" as const },
      { category: "legal" as const },
    ],
    outcomes: [
      { outcome: "interested" as const, submitted_at: "2026-01-10T00:00:00Z", private_note: "hidden" },
    ],
    final_admin_decision: "admin_approved_subject_to_conditions",
    approved_lessons: ["lesson-1"],
    private_funder_notes: "MUST NOT LEAK",
    unreleased_credit_material: "MUST NOT LEAK",
    admin_only_notes: "MUST NOT LEAK",
    raw_provider_data: { x: 1 },
    other_funder_details: { y: 2 },
  };

  it("strips forbidden keys and original/private text", () => {
    const intent = buildMemoryIntent({ ...src });
    const json = JSON.stringify(intent);
    expect(json).not.toMatch(/MUST NOT LEAK/);
    expect(json).not.toMatch(/secret raw text/);
    expect(json).not.toMatch(/hidden/);
    expect(intent.request_summary).toEqual(expect.arrayContaining([
      { category: "commercial", count: 2 },
      { category: "legal", count: 1 },
    ]));
    expect(intent.screened_safe).toBe(true);
  });

  it("screenMemoryIntentSafe rejects tainted objects", () => {
    expect(screenMemoryIntentSafe({ private_funder_notes: "x", screened_safe: true })).toBe(false);
    expect(screenMemoryIntentSafe(buildMemoryIntent({ ...src }))).toBe(true);
  });
});
