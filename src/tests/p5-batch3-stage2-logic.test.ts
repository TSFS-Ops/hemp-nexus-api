/**
 * P-5 Batch 3 — Stage 2 pure-logic tests.
 *
 * Covers role categorisation, permission matrix, access grants,
 * visibility, downloads, request lifecycle, outcomes, exit/revocation,
 * multi-funder separation, provider wording, API field allow/block,
 * and readiness/finality/Memory eligibility.
 */
import { describe, it, expect } from "vitest";
import {
  categoriseRole,
  inheritsInternalPermissions,
  isFunderRole,
  isInternalRole,
} from "@/lib/p5-batch3/roles";
import {
  allowedCapabilities,
  canFunderDo,
  forbiddenCapabilities,
} from "@/lib/p5-batch3/permissions";
import {
  checkAccessGrant,
  isCrossFunderLeak,
  type P5B3AccessGrant,
} from "@/lib/p5-batch3/access-grants";
import {
  applyFunderVisibility,
  isFieldVisibleToFunder,
  maskBankAccount,
} from "@/lib/p5-batch3/visibility";
import { decideDownload, invalidateOnRevocation } from "@/lib/p5-batch3/downloads";
import {
  applyAdminExternalEdit,
  canTransitionRequest,
  nextRequestStatuses,
} from "@/lib/p5-batch3/request-lifecycle";
import {
  isTerminalForFunder,
  mapOutcomeToStatus,
  requiresAdminReview,
} from "@/lib/p5-batch3/outcomes";
import { canReinstate, TRIGGER_TO_REASON } from "@/lib/p5-batch3/exit-revocation";
import {
  applyFunderDecision,
  isIsolated,
  scopeToFunder,
} from "@/lib/p5-batch3/multi-funder";
import {
  isLabelAllowed,
  isLabelSafe,
  isLabelUnsafe,
} from "@/lib/p5-batch3/provider-wording";
import {
  apiIsSubsetOfDashboard,
  filterForApi,
  isApiFieldAllowed,
} from "@/lib/p5-batch3/api-fields";
import {
  fundsAlonePermitFinality,
  isFinalityEligible,
  isMemoryEligible,
} from "@/lib/p5-batch3/readiness-eligibility";

const baseGrant: P5B3AccessGrant = {
  status: "active",
  funder_organisation_id: "org_a",
  funder_user_id: "user_1",
  transaction_id: "tx_1",
  evidence_pack_version: 3,
  expires_at: new Date(Date.now() + 86_400_000).toISOString(),
};

describe("Stage 2 — roles", () => {
  it("categorises internal, funder, api roles", () => {
    expect(categoriseRole("platform_admin")).toBe("internal");
    expect(categoriseRole("funder_viewer")).toBe("funder");
    expect(categoriseRole("funder_api_client")).toBe("api_client");
  });
  it("funder roles do not inherit internal permissions", () => {
    for (const r of [
      "funder_viewer",
      "funder_reviewer",
      "funder_approver",
      "funder_org_admin",
      "external_adviser",
    ] as const) {
      expect(isFunderRole(r)).toBe(true);
      expect(isInternalRole(r as never)).toBe(false);
      expect(inheritsInternalPermissions(r)).toBe(false);
    }
  });
});

describe("Stage 2 — permissions matrix", () => {
  it("approver can mark outcomes, viewer cannot", () => {
    expect(canFunderDo("funder_approver", "mark_outcome")).toBe(true);
    expect(canFunderDo("funder_viewer", "mark_outcome")).toBe(false);
  });
  it("external adviser cannot download", () => {
    expect(canFunderDo("external_adviser", "download_released_pack")).toBe(false);
  });
  it("forbidden capabilities are never granted to any funder role", () => {
    for (const cap of forbiddenCapabilities()) {
      for (const role of [
        "funder_viewer",
        "funder_reviewer",
        "funder_approver",
        "funder_org_admin",
        "external_adviser",
      ] as const) {
        expect(canFunderDo(role, cap)).toBe(false);
      }
    }
  });
  it("role alone does not include transaction/grant data", () => {
    const caps = allowedCapabilities("funder_approver");
    expect(caps).not.toContain("approve_credit_directly");
    expect(caps).not.toContain("alter_governance_or_finality");
  });
});

describe("Stage 2 — access grants", () => {
  it("active grant allows access", () => {
    expect(
      checkAccessGrant({
        grant: baseGrant,
        user_id: "user_1",
        organisation_id: "org_a",
        transaction_id: "tx_1",
        evidence_pack_version: 3,
      }).allowed,
    ).toBe(true);
  });
  it("expired/revoked/pending grants deny", () => {
    for (const status of ["expired", "revoked", "pending"] as const) {
      const r = checkAccessGrant({
        grant: { ...baseGrant, status },
        user_id: "user_1",
        organisation_id: "org_a",
        transaction_id: "tx_1",
      });
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe(status);
    }
  });
  it("expiry by time denies", () => {
    const r = checkAccessGrant({
      grant: { ...baseGrant, expires_at: new Date(Date.now() - 1000).toISOString() },
      user_id: "user_1",
      organisation_id: "org_a",
      transaction_id: "tx_1",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("expired");
  });
  it("wrong org / user / tx / pack version denies", () => {
    expect(
      checkAccessGrant({
        grant: baseGrant,
        user_id: "user_1",
        organisation_id: "org_b",
        transaction_id: "tx_1",
      }).reason,
    ).toBe("wrong_organisation");
    expect(
      checkAccessGrant({
        grant: baseGrant,
        user_id: "user_2",
        organisation_id: "org_a",
        transaction_id: "tx_1",
      }).reason,
    ).toBe("wrong_user");
    expect(
      checkAccessGrant({
        grant: baseGrant,
        user_id: "user_1",
        organisation_id: "org_a",
        transaction_id: "tx_2",
      }).reason,
    ).toBe("wrong_transaction");
    expect(
      checkAccessGrant({
        grant: baseGrant,
        user_id: "user_1",
        organisation_id: "org_a",
        transaction_id: "tx_1",
        evidence_pack_version: 99,
      }).reason,
    ).toBe("wrong_pack_version");
  });
  it("cross-funder leak detection", () => {
    expect(isCrossFunderLeak("org_b", baseGrant)).toBe(true);
    expect(isCrossFunderLeak("org_a", baseGrant)).toBe(false);
  });
});

describe("Stage 2 — visibility", () => {
  it("allows released fields, blocks raw/admin fields", () => {
    expect(isFieldVisibleToFunder("transaction_summary")).toBe(true);
    expect(isFieldVisibleToFunder("raw_documents")).toBe(false);
    expect(isFieldVisibleToFunder("admin_internal_notes")).toBe(false);
    expect(isFieldVisibleToFunder("other_funder_status")).toBe(false);
    expect(isFieldVisibleToFunder("provider_raw_response")).toBe(false);
    expect(isFieldVisibleToFunder("provider_test_data")).toBe(false);
  });
  it("applyFunderVisibility drops blocked keys", () => {
    const v = applyFunderVisibility({
      transaction_summary: "ok",
      raw_documents: ["doc"],
      admin_internal_notes: "x",
      provider_safe_status_label: "Provider-ready",
    });
    expect(v).toEqual({
      transaction_summary: "ok",
      provider_safe_status_label: "Provider-ready",
    });
  });
  it("masks bank account by default", () => {
    expect(maskBankAccount("1234567890")).toBe("••••••7890");
    expect(maskBankAccount("12")).toBe("••");
  });
});

describe("Stage 2 — downloads", () => {
  const baseReq = {
    format: "pdf" as const,
    admin_released: true,
    watermark_applied: true,
    link_issued_at: new Date().toISOString(),
    pack_version: 3,
    grant: baseGrant,
    user_id: "user_1",
    organisation_id: "org_a",
    transaction_id: "tx_1",
  };
  it("released watermarked PDF within TTL allowed", () => {
    expect(decideDownload(baseReq).allowed).toBe(true);
  });
  it("raw and csv formats blocked", () => {
    for (const format of ["csv", "raw_kyc", "raw_bank", "raw_id", "raw_ubo", "db_export"] as const) {
      expect(decideDownload({ ...baseReq, format }).reason).toBe("raw_export_blocked");
    }
  });
  it("no admin release denies", () => {
    expect(decideDownload({ ...baseReq, admin_released: false }).reason).toBe(
      "no_admin_release",
    );
  });
  it("missing watermark denies", () => {
    expect(decideDownload({ ...baseReq, watermark_applied: false }).reason).toBe(
      "missing_watermark",
    );
  });
  it("link older than 7 days denies", () => {
    expect(
      decideDownload({
        ...baseReq,
        link_issued_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
      }).reason,
    ).toBe("link_expired");
  });
  it("revocation invalidates immediately", () => {
    expect(invalidateOnRevocation({ ...baseGrant, status: "revoked" }).invalidated).toBe(
      true,
    );
  });
});

describe("Stage 2 — request lifecycle", () => {
  it("happy path transitions", () => {
    const path = [
      ["draft", "submitted"],
      ["submitted", "admin_review"],
      ["admin_review", "approved_to_company"],
      ["approved_to_company", "assigned"],
      ["assigned", "response_pending"],
      ["response_pending", "answered"],
      ["answered", "follow_up_requested"],
      ["follow_up_requested", "admin_review"],
      ["answered", "closed"],
    ] as const;
    for (const [a, b] of path) expect(canTransitionRequest(a, b)).toBe(true);
  });
  it("terminal states cannot transition", () => {
    expect(nextRequestStatuses("closed")).toEqual([]);
    expect(nextRequestStatuses("withdrawn")).toEqual([]);
  });
  it("rejects illegal transitions", () => {
    expect(canTransitionRequest("draft", "answered")).toBe(false);
    expect(canTransitionRequest("closed", "draft")).toBe(false);
  });
  it("preserves original text when admin edits external wording", () => {
    const edited = applyAdminExternalEdit(
      { original_text: "ORIG" },
      "polished external",
    );
    expect(edited.original_text).toBe("ORIG");
    expect(edited.external_text).toBe("polished external");
  });
});

describe("Stage 2 — outcomes", () => {
  it("maps every outcome to a funder status", () => {
    expect(mapOutcomeToStatus("interested")).toBe("interested");
    expect(mapOutcomeToStatus("not_interested")).toBe("declined");
    expect(mapOutcomeToStatus("funding_approved_subject_to_admin")).toBe(
      "funding_decision_submitted",
    );
  });
  it("admin review required for funding/term-sheet/conditional outcomes", () => {
    expect(requiresAdminReview("funding_approved_subject_to_admin")).toBe(true);
    expect(requiresAdminReview("term_sheet_provided")).toBe(true);
    expect(requiresAdminReview("conditional_support")).toBe(true);
    expect(requiresAdminReview("interested")).toBe(false);
  });
  it("declined and exited are terminal for funder", () => {
    expect(isTerminalForFunder("exited")).toBe(true);
    expect(isTerminalForFunder("declined")).toBe(true);
    expect(isTerminalForFunder("interested")).toBe(false);
  });
});

describe("Stage 2 — exit & revocation", () => {
  it("triggers map to reasons", () => {
    expect(TRIGGER_TO_REASON.voluntary_exit).toBe("funder_withdrawn");
    expect(TRIGGER_TO_REASON.admin_revocation).toBe("admin_revoked");
    expect(TRIGGER_TO_REASON.expiry).toBe("access_expired");
  });
  it("only platform admin with reason and expiry can reinstate", () => {
    expect(
      canReinstate({
        actor_role: "funder_org_admin",
        reason: "x",
        new_expires_at: "2030-01-01",
      }).reason,
    ).toBe("not_platform_admin");
    expect(
      canReinstate({ actor_role: "platform_admin", reason: "", new_expires_at: "2030" })
        .reason,
    ).toBe("missing_reason");
    expect(
      canReinstate({
        actor_role: "platform_admin",
        reason: "credit appeal",
        new_expires_at: null,
      }).reason,
    ).toBe("missing_expiry");
    expect(
      canReinstate({
        actor_role: "platform_admin",
        reason: "credit appeal",
        new_expires_at: "2030-01-01",
      }).allowed,
    ).toBe(true);
  });
});

describe("Stage 2 — multi-funder separation", () => {
  const view = {
    transaction_id: "tx_1",
    engagements: [
      {
        funder_organisation_id: "org_a",
        status: "interested" as const,
        notes_visible_to_funder: [],
        request_thread_ids: [],
        audit_log_ids: [],
        released_pack_versions: [3],
        exit_outcome: null,
      },
      {
        funder_organisation_id: "org_b",
        status: "declined" as const,
        notes_visible_to_funder: [],
        request_thread_ids: [],
        audit_log_ids: [],
        released_pack_versions: [3],
        exit_outcome: null,
      },
    ],
  };
  it("scope hides sibling funder", () => {
    const scoped = scopeToFunder(view, "org_a");
    expect(scoped.engagements).toHaveLength(1);
    expect(isIsolated(scoped, "org_a")).toBe(true);
  });
  it("one funder's decision does not mutate sibling", () => {
    const after = applyFunderDecision(view, "org_a", "declined");
    expect(after.engagements.find((e) => e.funder_organisation_id === "org_b")?.status)
      .toBe("declined"); // unchanged
    expect(after.engagements.find((e) => e.funder_organisation_id === "org_a")?.status)
      .toBe("declined");
  });
});

describe("Stage 2 — provider wording", () => {
  const safeCtx = {
    provider_live: false,
    provider_result_reference: null,
    approved_manual_decision_ref: null,
  };
  it("safe labels always allowed", () => {
    expect(isLabelSafe("Provider-ready")).toBe(true);
    expect(isLabelAllowed("External Provider Result Pending", safeCtx)).toBe(true);
  });
  it("unsafe labels blocked without live provider or manual decision", () => {
    for (const label of [
      "Verified",
      "Guaranteed",
      "Compliance Passed",
      "Sanctions Cleared",
      "Bankable",
      "Provider Verified",
      "Investment Grade",
      "Due Diligence Complete",
    ]) {
      expect(isLabelUnsafe(label)).toBe(true);
      expect(isLabelAllowed(label, safeCtx)).toBe(false);
    }
  });
  it("unsafe label permitted when live provider result present", () => {
    expect(
      isLabelAllowed("Provider Verified", {
        provider_live: true,
        provider_result_reference: "prov_ref_123",
        approved_manual_decision_ref: null,
      }),
    ).toBe(true);
  });
});

describe("Stage 2 — API field allow/block", () => {
  it("API allow-list is subset of dashboard allow-list", () => {
    expect(apiIsSubsetOfDashboard()).toBe(true);
  });
  it("API blocks raw and internal fields", () => {
    for (const f of [
      "raw_documents",
      "raw_bank_account_number",
      "raw_passport_number",
      "raw_ubo_details",
      "admin_internal_notes",
      "provider_raw_response",
      "other_funder_status",
      "released_evidence_pack_url",
    ]) {
      expect(isApiFieldAllowed(f)).toBe(false);
    }
  });
  it("filterForApi keeps only allowed fields", () => {
    const out = filterForApi({
      transaction_summary: "ok",
      released_evidence_pack_url: "https://x",
      raw_documents: ["x"],
      provider_safe_status_label: "Provider-ready",
    });
    expect(out).toEqual({
      transaction_summary: "ok",
      provider_safe_status_label: "Provider-ready",
    });
  });
});

describe("Stage 2 — readiness/finality/Memory", () => {
  it("funder action alone cannot reach finality", () => {
    expect(fundsAlonePermitFinality()).toBe(false);
    expect(
      isFinalityEligible({
        funder_signal_present: true,
        admin_review_complete: false,
        compliance_clearance_complete: false,
      }),
    ).toBe(false);
  });
  it("finality requires funder signal + admin + compliance", () => {
    expect(
      isFinalityEligible({
        funder_signal_present: true,
        admin_review_complete: true,
        compliance_clearance_complete: true,
      }),
    ).toBe(true);
  });
  it("Memory excludes private funder notes and unreleased internal credit", () => {
    expect(
      isMemoryEligible({
        is_private_funder_note: true,
        is_unreleased_internal_credit: false,
        is_admin_released: true,
      }),
    ).toBe(false);
    expect(
      isMemoryEligible({
        is_private_funder_note: false,
        is_unreleased_internal_credit: true,
        is_admin_released: true,
      }),
    ).toBe(false);
    expect(
      isMemoryEligible({
        is_private_funder_note: false,
        is_unreleased_internal_credit: false,
        is_admin_released: true,
      }),
    ).toBe(true);
  });
});
