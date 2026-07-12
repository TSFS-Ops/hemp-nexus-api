/**
 * Institutional Funder Evidence Workspace — Batch 2
 * Admin console UI + client logic tests (pure — no DOM render required).
 *
 * Covers:
 *   - release form zod validation (required fields, future expiry,
 *     consent-gate → override reason, raw-doc defaults false);
 *   - reject-onboarding client rejects empty reason before RPC;
 *   - revoke-release client rejects empty reason before RPC;
 *   - permissions helper defaults + override-required helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { releaseFormSchema } from "@/lib/funder-workspace/validation";
import {
  DEFAULT_RELEASE_PERMISSIONS,
  RAW_DOCUMENT_PERMISSION_KEYS,
  requiresAdminOverride,
} from "@/lib/funder-workspace/permissions";

vi.mock("@/integrations/supabase/client", () => {
  const rpc = vi.fn();
  const from = vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    then: undefined,
  }));
  return { supabase: { rpc, from } };
});

import {
  approveOnboardingRequest,
  createRelease,
  rejectOnboardingRequest,
  revokeRelease,
  FUNDER_WORKSPACE_ADMIN_RPCS,
} from "@/lib/funder-workspace/admin-client";
import { supabase } from "@/integrations/supabase/client";

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
const UUID = "00000000-0000-4000-8000-000000000001";

const baseValues = {
  funder_organisation_id: UUID,
  match_id: UUID,
  deal_reference: "DEAL-001",
  evidence_pack_id: UUID,
  evidence_pack_version: "1",
  release_reason: "Initial release",
  expires_at: FUTURE,
  buyer_consent_status: "granted" as const,
  seller_consent_status: "granted" as const,
  admin_override_reason: "",
  ...DEFAULT_RELEASE_PERMISSIONS,
};


describe("Funder Workspace Batch 2 — permission defaults", () => {
  it("raw-doc/unmasked toggles default false", () => {
    for (const k of RAW_DOCUMENT_PERMISSION_KEYS) {
      expect(DEFAULT_RELEASE_PERMISSIONS[k]).toBe(false);
    }
    expect(DEFAULT_RELEASE_PERMISSIONS.can_download_compiled_pack).toBe(false);
  });

  it("summary/room defaults are true", () => {
    expect(DEFAULT_RELEASE_PERMISSIONS.can_view_evidence_summary).toBe(true);
    expect(DEFAULT_RELEASE_PERMISSIONS.can_view_evidence_room).toBe(true);
  });

  it("requiresAdminOverride reflects the DB consent gate exactly", () => {
    expect(requiresAdminOverride("granted", "granted")).toBe(false);
    expect(requiresAdminOverride("granted", "not_required")).toBe(false);
    expect(requiresAdminOverride("not_required", "not_required")).toBe(false);
    expect(requiresAdminOverride("pending", "granted")).toBe(true);
    expect(requiresAdminOverride("granted", "pending")).toBe(true);
    expect(requiresAdminOverride("declined", "granted")).toBe(true);
    expect(requiresAdminOverride("overridden", "overridden")).toBe(true);
  });
});

describe("Funder Workspace Batch 2 — release form validation", () => {
  it("accepts a fully valid release payload", () => {
    const parsed = releaseFormSchema.safeParse(baseValues);
    expect(parsed.success).toBe(true);
  });

  it("requires the funder organisation, canonical deal, evidence pack selection and reason", () => {
    const parsed = releaseFormSchema.safeParse({
      ...baseValues,
      funder_organisation_id: "",
      match_id: "",
      evidence_pack_id: "",
      evidence_pack_version: "",
      release_reason: "",
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((i) => i.path.join("."));
    for (const k of [
      "funder_organisation_id",
      "match_id",
      "evidence_pack_id",
      "evidence_pack_version",
      "release_reason",
    ]) {
      expect(paths, k).toContain(k);
    }
    expect(parsed.error.issues.map((i) => i.message).join(" ")).toMatch(/Evidence pack selection is required/);
  });


  it("rejects an expiry in the past", () => {
    const parsed = releaseFormSchema.safeParse({ ...baseValues, expires_at: PAST });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "expires_at")).toBe(true);
    }
  });

  it("blocks release when consent missing and override reason blank", () => {
    const parsed = releaseFormSchema.safeParse({
      ...baseValues,
      buyer_consent_status: "pending",
      admin_override_reason: "",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "admin_override_reason")).toBe(true);
    }
  });

  it("blocks release when override reason is whitespace only", () => {
    const parsed = releaseFormSchema.safeParse({
      ...baseValues,
      buyer_consent_status: "declined",
      admin_override_reason: "   \n\t   ",
    });
    expect(parsed.success).toBe(false);
  });

  it("allows release with missing consent when a non-empty override reason is provided", () => {
    const parsed = releaseFormSchema.safeParse({
      ...baseValues,
      buyer_consent_status: "pending",
      seller_consent_status: "declined",
      admin_override_reason: "Deal syndication urgency; SPA already signed by both parties.",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("Funder Workspace Batch 2 — client RPC contracts", () => {
  const rpcMock = (supabase as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc;

  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("exports the four approved Batch 2 mutation RPCs (plus additive Batch 6 read-only RPCs)", () => {
    const set = new Set(FUNDER_WORKSPACE_ADMIN_RPCS);
    for (const rpc of [
      "fw_admin_approve_funder_org_v1",
      "fw_admin_reject_funder_org_v1",
      "fw_admin_release_deal_v1",
      "fw_admin_revoke_deal_release_v1",
    ]) {
      expect(set.has(rpc as (typeof FUNDER_WORKSPACE_ADMIN_RPCS)[number])).toBe(true);
    }
  });


  it("approveOnboardingRequest calls fw_admin_approve_funder_org_v1", async () => {
    rpcMock.mockResolvedValueOnce({ data: UUID, error: null });
    await approveOnboardingRequest({ p_request_id: UUID, p_notes_internal: "ok" });
    expect(rpcMock).toHaveBeenCalledWith("fw_admin_approve_funder_org_v1", {
      p_request_id: UUID,
      p_notes_internal: "ok",
    });
  });

  it("rejectOnboardingRequest refuses empty reason without calling the RPC", async () => {
    await expect(
      rejectOnboardingRequest({ p_request_id: UUID, p_reason: "  " }),
    ).rejects.toThrow(/required/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejectOnboardingRequest calls fw_admin_reject_funder_org_v1 with trimmed reason", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await rejectOnboardingRequest({ p_request_id: UUID, p_reason: "  duplicate submission  " });
    expect(rpcMock).toHaveBeenCalledWith("fw_admin_reject_funder_org_v1", {
      p_request_id: UUID,
      p_reason: "duplicate submission",
    });
  });

  it("createRelease calls fw_admin_release_deal_v1 with the full payload", async () => {
    rpcMock.mockResolvedValueOnce({ data: UUID, error: null });
    const id = await createRelease({
      p_funder_organisation_id: UUID,
      p_deal_reference: "DEAL-XYZ",
      p_evidence_pack_id: UUID,
      p_evidence_pack_version: "1",
      p_release_reason: "cover note",
      p_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      p_can_download_compiled_pack: false,
      p_can_view_raw_documents: false,
      p_can_download_raw_documents: false,
      p_can_view_unmasked_sensitive_details: false,
      p_buyer_consent_status: "granted",
      p_seller_consent_status: "granted",
      p_admin_override_reason: null,
    });
    expect(id).toBe(UUID);
    expect(rpcMock).toHaveBeenCalledWith(
      "fw_admin_release_deal_v1",
      expect.objectContaining({
        p_funder_organisation_id: UUID,
        p_deal_reference: "DEAL-XYZ",
        p_can_view_raw_documents: false,
      }),
    );
  });

  it("revokeRelease refuses empty reason and does not call the RPC", async () => {
    await expect(
      revokeRelease({ p_release_id: UUID, p_reason: "" }),
    ).rejects.toThrow(/required/i);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("revokeRelease calls fw_admin_revoke_deal_release_v1 with a trimmed reason", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    await revokeRelease({ p_release_id: UUID, p_reason: "  breach of NDA  " });
    expect(rpcMock).toHaveBeenCalledWith("fw_admin_revoke_deal_release_v1", {
      p_release_id: UUID,
      p_reason: "breach of NDA",
    });
  });
});
