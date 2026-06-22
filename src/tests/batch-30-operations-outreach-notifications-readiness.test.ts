import { describe, it, expect } from "vitest";
import {
  REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES,
  REGISTRY_OPS_AI_DRAFT_ONLY,
  REGISTRY_OPS_AI_MAY_AUTO_SEND,
  REGISTRY_OPS_AI_AUTO_SEND_ENABLED,
  REGISTRY_OPS_AI_FIELDS_BLOCKED,
  REGISTRY_OPS_AI_FIELDS_ADMIN_ONLY,
  REGISTRY_OPS_AI_FIELDS_MASKED,
  REGISTRY_OPS_AI_FIELDS_ALLOWED,
  classifyAiField,
  evaluateAiDraftGate,
  REGISTRY_OPS_AI_ALWAYS_FORBIDDEN_PHRASES,
  REGISTRY_OPS_AI_REQUIRED_SAFE_PHRASES,
  scanForbiddenWording,
  REGISTRY_OPS_OUTREACH_APPROVAL_ROLES,
  REGISTRY_OPS_OUTREACH_TWO_PERSON_CATEGORIES,
  evaluateOutreachApproval,
  REGISTRY_OPS_SENDING_MODE,
  REGISTRY_OPS_WHATSAPP_ENABLED,
  REGISTRY_OPS_SMS_ENABLED,
  REGISTRY_OPS_OUTREACH_STATUSES,
  REGISTRY_OPS_MANUAL_CONTACT_LOG_REPRESENTS_SMS_OR_WHATSAPP,
  evaluateRealEmailSendGate,
  REGISTRY_OPS_DNC_SCOPES,
  REGISTRY_OPS_DNC_EFFECTS,
  REGISTRY_OPS_DNC_ADD_ROLES,
  REGISTRY_OPS_DNC_REMOVE_ROLES_REQUIRED,
  evaluateDncAdd,
  evaluateDncRemove,
  REGISTRY_OPS_QUEUE_PRIORITY_ORDER,
  REGISTRY_OPS_SLAS_BUSINESS_DAYS,
  REGISTRY_OPS_OVERDUE_AUTO_APPROVE_ENABLED,
  evaluateOverdue,
  REGISTRY_OPS_ADMIN_ALERTS,
  REGISTRY_OPS_COMPLIANCE_ALERTS,
  REGISTRY_OPS_COMMERCIAL_ALERTS,
  REGISTRY_OPS_NOTIFICATION_CHANNELS,
  REGISTRY_OPS_NOTIFICATION_FUTURE_DISABLED_CHANNELS,
  REGISTRY_OPS_NOTIFICATION_MATRIX,
  notificationChannelsFor,
  REGISTRY_OPS_WHATSAPP_DISABLED_LABEL,
  REGISTRY_OPS_SMS_DISABLED_LABEL,
  REGISTRY_OPS_READINESS_AUDIENCES,
  REGISTRY_OPS_READINESS_DEFAULT_AUDIENCE,
  REGISTRY_OPS_READINESS_EXTERNAL_HIDDEN_FIELDS,
  readinessAudienceProjection,
  projectReadinessForAudience,
  REGISTRY_OPS_CLIENT_SAFE_WORDING,
  REGISTRY_OPS_READINESS_SECTIONS,
  REGISTRY_OPS_READINESS_REQUIRED_LABELS,
  REGISTRY_OPS_READINESS_BUILD_VS_DATA_COLLAPSED,
  REGISTRY_OPS_AUDIT_EVENTS,
} from "@/lib/registry-operations-outreach-rules";

describe("Batch 30 — operations / outreach / notifications / readiness", () => {
  it("AI may draft only allowed categories", () => {
    const ok = evaluateAiDraftGate({
      category: "claim_invite",
      source_fields: ["company_legal_name", "country"],
      case_approved_masked_fields: [],
      draft_text: "Please provide evidence for review.",
      do_not_contact_blocks_scope: false,
    });
    expect(ok.allowed).toBe(true);
  });

  it("AI cannot draft disallowed category", () => {
    const r = evaluateAiDraftGate({
      category: "verification_decision",
      source_fields: ["company_legal_name"],
      case_approved_masked_fields: [],
      draft_text: "ok",
      do_not_contact_blocks_scope: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocking_reasons.some((x) => x.startsWith("category_not_allowed"))).toBe(true);
  });

  it("AI is draft-only and cannot auto-send", () => {
    expect(REGISTRY_OPS_AI_DRAFT_ONLY).toBe(true);
    expect(REGISTRY_OPS_AI_MAY_AUTO_SEND).toBe(false);
    expect(REGISTRY_OPS_AI_AUTO_SEND_ENABLED).toBe(false);
  });

  it("AI cannot use raw bank, identity, or provider credentials", () => {
    for (const f of ["raw_bank_details", "identity_documents", "provider_credentials", "unapproved_personal_data"]) {
      expect(classifyAiField(f)).toBe("blocked");
      const r = evaluateAiDraftGate({
        category: "claim_invite",
        source_fields: [f],
        case_approved_masked_fields: [],
        draft_text: "ok",
        do_not_contact_blocks_scope: false,
      });
      expect(r.allowed).toBe(false);
      expect(r.blocking_reasons.some((x) => x.startsWith("blocked_field"))).toBe(true);
    }
  });

  it("AI cannot expose masked fields unless approved for the case", () => {
    const blocked = evaluateAiDraftGate({
      category: "claim_invite",
      source_fields: ["email"],
      case_approved_masked_fields: [],
      draft_text: "ok",
      do_not_contact_blocks_scope: false,
    });
    expect(blocked.allowed).toBe(false);
    const ok = evaluateAiDraftGate({
      category: "claim_invite",
      source_fields: ["email"],
      case_approved_masked_fields: ["email"],
      draft_text: "ok",
      do_not_contact_blocks_scope: false,
    });
    expect(ok.allowed).toBe(true);
  });

  it("AI forbidden wording is blocked", () => {
    for (const phrase of REGISTRY_OPS_AI_ALWAYS_FORBIDDEN_PHRASES) {
      expect(scanForbiddenWording(`We confirm this is ${phrase} for you.`)).toContain(phrase);
    }
    const r = evaluateAiDraftGate({
      category: "evidence_request",
      source_fields: ["company_legal_name"],
      case_approved_masked_fields: [],
      draft_text: "Your account is bank approved.",
      do_not_contact_blocks_scope: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocking_reasons.some((x) => x.startsWith("forbidden_wording"))).toBe(true);
  });

  it("required safe phrases are pinned", () => {
    expect(REGISTRY_OPS_AI_REQUIRED_SAFE_PHRASES).toContain("Please provide evidence for review");
    expect(REGISTRY_OPS_AI_REQUIRED_SAFE_PHRASES).toContain(
      "This request does not by itself confirm verification or authority.",
    );
  });

  it("AI text always requires human approval", () => {
    const r = evaluateOutreachApproval({
      category: "evidence_request",
      is_template: true,
      approver_role: "platform_admin",
      second_approver_role: null,
      ai_generated: true,
      human_approved: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocking_reasons).toContain("ai_text_requires_human_approval");
  });

  it("support_user can prepare drafts; platform_admin can approve ordinary", () => {
    expect(REGISTRY_OPS_OUTREACH_APPROVAL_ROLES.prepare_draft).toContain("support_user");
    const r = evaluateOutreachApproval({
      category: "evidence_request",
      is_template: true,
      approver_role: "platform_admin",
      second_approver_role: null,
      ai_generated: false,
      human_approved: true,
    });
    expect(r.allowed).toBe(true);
  });

  it("compliance_owner required for bank/authority/dispute outreach", () => {
    for (const cat of ["bank_evidence_reminder", "authority_reminder", "dispute_notice"] as const) {
      const bad = evaluateOutreachApproval({
        category: cat,
        is_template: true,
        approver_role: "platform_admin",
        second_approver_role: "compliance_owner",
        ai_generated: false,
        human_approved: true,
      });
      expect(bad.allowed).toBe(false);
      const ok = evaluateOutreachApproval({
        category: cat,
        is_template: true,
        approver_role: "compliance_owner",
        second_approver_role: "platform_admin",
        ai_generated: false,
        human_approved: true,
      });
      expect(ok.allowed).toBe(true);
    }
  });

  it("two-person approval required for institutional / non-template outreach", () => {
    expect(REGISTRY_OPS_OUTREACH_TWO_PERSON_CATEGORIES).toContain("api_onboarding_reminder");
    const r = evaluateOutreachApproval({
      category: "api_onboarding_reminder",
      is_template: true,
      approver_role: "compliance_owner",
      second_approver_role: null,
      ai_generated: false,
      human_approved: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocking_reasons).toContain("second_approver_required");
  });

  it("sending mode + WhatsApp + SMS state pinned", () => {
    expect(REGISTRY_OPS_SENDING_MODE).toBe("mixed_with_exact_gates");
    expect(REGISTRY_OPS_WHATSAPP_ENABLED).toBe(false);
    expect(REGISTRY_OPS_SMS_ENABLED).toBe(false);
    expect(REGISTRY_OPS_WHATSAPP_DISABLED_LABEL).toBe("WhatsApp not configured");
    expect(REGISTRY_OPS_SMS_DISABLED_LABEL).toBe("SMS not configured");
    expect(REGISTRY_OPS_OUTREACH_STATUSES).toEqual(
      expect.arrayContaining([
        "drafted",
        "approved",
        "sent_email",
        "manual_contact_logged",
        "whatsapp_disabled",
        "sms_disabled",
      ]),
    );
  });

  it("manual contact log is not represented as SMS/WhatsApp", () => {
    expect(REGISTRY_OPS_MANUAL_CONTACT_LOG_REPRESENTS_SMS_OR_WHATSAPP).toBe(false);
  });

  it("real email requires approved channel + template + human approval", () => {
    const r = evaluateRealEmailSendGate({
      channel_approved: false,
      template_approved: true,
      human_approved: true,
      do_not_contact_blocks_scope: false,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocking_reasons).toContain("channel_not_approved");
    const ok = evaluateRealEmailSendGate({
      channel_approved: true,
      template_approved: true,
      human_approved: true,
      do_not_contact_blocks_scope: false,
    });
    expect(ok.allowed).toBe(true);
  });

  it("do-not-contact blocks AI draft, approval, sending", () => {
    expect(REGISTRY_OPS_DNC_SCOPES).toEqual(["person", "email", "phone", "company", "channel"]);
    expect(REGISTRY_OPS_DNC_EFFECTS).toEqual(["block_ai_draft", "block_approval", "block_sending"]);
    const r = evaluateAiDraftGate({
      category: "claim_invite",
      source_fields: ["company_legal_name"],
      case_approved_masked_fields: [],
      draft_text: "ok",
      do_not_contact_blocks_scope: true,
    });
    expect(r.allowed).toBe(false);
    expect(r.blocking_reasons).toContain("do_not_contact_in_scope");
    const e = evaluateRealEmailSendGate({
      channel_approved: true,
      template_approved: true,
      human_approved: true,
      do_not_contact_blocks_scope: true,
    });
    expect(e.allowed).toBe(false);
  });

  it("DNC add requires allowed role; support_user requires reason", () => {
    expect(REGISTRY_OPS_DNC_ADD_ROLES).toContain("support_user_with_reason");
    expect(evaluateDncAdd({ actor_role: "support_user", reason: null }).allowed).toBe(false);
    expect(evaluateDncAdd({ actor_role: "support_user", reason: "duplicate company" }).allowed).toBe(true);
    expect(evaluateDncAdd({ actor_role: "trader", reason: "x" }).allowed).toBe(false);
    expect(evaluateDncAdd({ actor_role: "platform_admin", reason: null }).allowed).toBe(true);
  });

  it("DNC removal requires platform_admin + compliance_owner", () => {
    expect(REGISTRY_OPS_DNC_REMOVE_ROLES_REQUIRED).toEqual(["platform_admin", "compliance_owner"]);
    expect(evaluateDncRemove({ approver_roles: ["platform_admin"] }).allowed).toBe(false);
    expect(evaluateDncRemove({ approver_roles: ["platform_admin", "compliance_owner"] }).allowed).toBe(true);
  });

  it("queue priorities 1..10 match client decision and owner roles", () => {
    const order = REGISTRY_OPS_QUEUE_PRIORITY_ORDER.map((q) => q.queue);
    expect(order).toEqual([
      "bank_detail_review",
      "authority_to_act_review",
      "claim_review",
      "data_disputes_corrections",
      "import_batch_review_quarantine",
      "duplicate_review_merge",
      "api_client_approval",
      "provider_country_readiness_review",
      "outreach_approval",
      "stale_expired_readiness_review",
    ]);
    expect(REGISTRY_OPS_QUEUE_PRIORITY_ORDER[0].owner_roles).toContain("compliance_owner");
    expect(REGISTRY_OPS_QUEUE_PRIORITY_ORDER[6].owner_roles).toContain("platform_admin");
    expect(REGISTRY_OPS_QUEUE_PRIORITY_ORDER[6].owner_roles).toContain("compliance_owner");
  });

  it("SLAs match the client decisions", () => {
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.bank_detail_review_initial).toBe(1);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.bank_detail_review_escalated_evidence).toBe(3);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.authority_to_act_review).toBe(2);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.claim_review).toBe(2);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.data_disputes_corrections_triage).toBe(3);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.data_disputes_corrections_resolution).toBe(10);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.import_batch_review).toBe(2);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.duplicate_review).toBe(3);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.api_client_approval).toBe(5);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.provider_country_readiness).toBe(5);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.outreach_approval).toBe(1);
    expect(REGISTRY_OPS_SLAS_BUSINESS_DAYS.stale_expired_review).toBe(5);
  });

  it("overdue items raise admin alerts but never auto-approve", () => {
    expect(REGISTRY_OPS_OVERDUE_AUTO_APPROVE_ENABLED).toBe(false);
    const r = evaluateOverdue({ queue: "bank_detail_review", business_days_open: 5 });
    expect(r.overdue).toBe(true);
    expect(r.auto_approve).toBe(false);
    expect(r.raises_admin_alert).toBe(true);
  });

  it("alert trigger sets cover admin, compliance, commercial categories", () => {
    expect(REGISTRY_OPS_ADMIN_ALERTS).toContain("import_failure");
    expect(REGISTRY_OPS_ADMIN_ALERTS).toContain("sla_overdue");
    expect(REGISTRY_OPS_COMPLIANCE_ALERTS).toContain("bank_dispute");
    expect(REGISTRY_OPS_COMPLIANCE_ALERTS).toContain("do_not_contact_override");
    for (const t of ["api_client_usage_80_percent", "api_client_usage_100_percent", "api_client_usage_120_percent"]) {
      expect(REGISTRY_OPS_COMMERCIAL_ALERTS).toContain(t);
    }
  });

  it("notification matrix uses in-app/email; WhatsApp/SMS remain future-disabled", () => {
    expect(REGISTRY_OPS_NOTIFICATION_CHANNELS).toEqual(["in_app", "email", "none"]);
    expect(REGISTRY_OPS_NOTIFICATION_FUTURE_DISABLED_CHANNELS).toEqual(["whatsapp", "sms"]);
    for (const ev of ["claim_submitted", "authority_submitted", "correction_submitted"]) {
      expect(notificationChannelsFor(ev)).toEqual(expect.arrayContaining(["in_app", "email"]));
    }
  });

  it("bank notifications only go to authorised company users", () => {
    const e = REGISTRY_OPS_NOTIFICATION_MATRIX.find((m) => m.event === "bank_details_submitted")!;
    expect(e.audience).toEqual(expect.arrayContaining(["authorised_company_user"]));
    expect(e.audience).not.toContain("public");
  });

  it("API key notifications target client admin and platform_admin", () => {
    const e = REGISTRY_OPS_NOTIFICATION_MATRIX.find((m) => m.event === "api_key_created")!;
    expect(e.audience).toEqual(expect.arrayContaining(["api_client_admin", "platform_admin"]));
  });

  it("readiness dashboard audience rules prevent external leaks", () => {
    expect(REGISTRY_OPS_READINESS_DEFAULT_AUDIENCE).toBe("internal_admin");
    expect(readinessAudienceProjection("internal_admin").show_full_blockers).toBe(true);
    expect(readinessAudienceProjection("company_director_authorised_user").show_own_company_summary).toBe(true);
    expect(readinessAudienceProjection("company_director_authorised_user").show_admin_notes).toBe(false);
    expect(readinessAudienceProjection("bank_institutional_client").show_contract_scope_fields).toBe(true);
    expect(readinessAudienceProjection("public").show_public_labels_only).toBe(true);
    const raw = { country: "ZA", internal_note: "x", risk_comment: "y", source_licence_detail: "z", reviewer_name: "Jane", raw_bank_data: "***" };
    const projected = projectReadinessForAudience("public", raw);
    for (const hidden of REGISTRY_OPS_READINESS_EXTERNAL_HIDDEN_FIELDS) {
      expect(projected).not.toHaveProperty(hidden);
    }
    expect(projected.country).toBe("ZA");
  });

  it("build readiness and data readiness are not collapsed", () => {
    expect(REGISTRY_OPS_READINESS_BUILD_VS_DATA_COLLAPSED).toBe(false);
    expect(REGISTRY_OPS_READINESS_SECTIONS).toEqual(
      expect.arrayContaining(["platform_build_status", "api_sandbox_readiness", "api_production_readiness"]),
    );
    expect(REGISTRY_OPS_READINESS_REQUIRED_LABELS).toEqual([
      "Built - data/use approval pending",
      "Data loaded - workflow not active",
    ]);
  });

  it("client-safe wording strings match exactly", () => {
    expect(REGISTRY_OPS_CLIENT_SAFE_WORDING.sms_disabled).toBe("SMS not configured");
    expect(REGISTRY_OPS_CLIENT_SAFE_WORDING.whatsapp_disabled).toBe("WhatsApp not configured");
    expect(REGISTRY_OPS_CLIENT_SAFE_WORDING.api_not_ready).toBe("Not available for production API output.");
    expect(REGISTRY_OPS_CLIENT_SAFE_WORDING.not_independently_verified).toContain(
      "has not been independently verified by Izenzo",
    );
  });

  it("audit events cover ai/outreach/dnc/queue/alert/notification/readiness", () => {
    const need = [
      "registry.ops.ai_draft.blocked",
      "registry.ops.outreach.approved",
      "registry.ops.outreach.sent_email",
      "registry.ops.outreach.manual_contact_logged",
      "registry.ops.dnc.added",
      "registry.ops.dnc.removed",
      "registry.ops.queue.sla_overdue_alert",
      "registry.ops.alert.compliance_raised",
      "registry.ops.notification.dispatched",
      "registry.ops.readiness.audience_projection",
    ];
    for (const n of need) expect(REGISTRY_OPS_AUDIT_EVENTS).toContain(n);
  });

  it("allowed AI draft categories match client list of 9", () => {
    expect(REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES.length).toBe(9);
    for (const c of [
      "claim_invite",
      "evidence_request",
      "authority_reminder",
      "bank_evidence_reminder",
      "correction_request",
      "dispute_notice",
      "no_result_company_addition_response",
      "api_onboarding_reminder",
      "support_follow_up",
    ]) {
      expect(REGISTRY_OPS_AI_ALLOWED_DRAFT_CATEGORIES).toContain(c);
    }
  });

  it("AI field tiers are non-overlapping classifications", () => {
    expect(classifyAiField("company_legal_name")).toBe("allowed");
    expect(classifyAiField("phone")).toBe("masked");
    expect(classifyAiField("internal_note")).toBe("admin_only");
    expect(classifyAiField("raw_bank_details")).toBe("blocked");
    expect(classifyAiField("zzz_unknown")).toBe("unknown");
    // also assert pinned arrays
    expect(REGISTRY_OPS_AI_FIELDS_ALLOWED.length).toBeGreaterThan(0);
    expect(REGISTRY_OPS_AI_FIELDS_MASKED.length).toBeGreaterThan(0);
    expect(REGISTRY_OPS_AI_FIELDS_ADMIN_ONLY.length).toBeGreaterThan(0);
    expect(REGISTRY_OPS_AI_FIELDS_BLOCKED.length).toBeGreaterThan(0);
  });

  it("readiness audiences enumerated correctly", () => {
    expect(REGISTRY_OPS_READINESS_AUDIENCES).toEqual([
      "internal_admin",
      "company_director_authorised_user",
      "bank_institutional_client",
      "prospect",
      "public",
    ]);
  });
});
