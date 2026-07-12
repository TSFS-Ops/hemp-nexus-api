/**
 * Cross-consistency: the admin (operator) surface and the funder (user)
 * surface must agree on effective release status, pack-download readiness,
 * and pack-generation preconditions. This test locks the shared helper
 * so any UI drift is caught at build time.
 */
import { describe, it, expect } from "vitest";
import {
  canGenerateSealedPack,
  consentSatisfied,
  effectiveReleaseStatus,
  isReleaseUsable,
  packDownloadReadiness,
  statusBadgeVariant,
  statusLabel,
} from "@/lib/funder-workspace/release-state";
import type {
  DealReleaseRow,
  PackVersionRow,
} from "@/lib/funder-workspace/types";

const base: DealReleaseRow = {
  id: "r1",
  funder_organisation_id: "f1",
  deal_reference: "DEAL-1",
  evidence_pack_id: "pack-1",
  evidence_pack_version: "1",
  release_status: "active",
  released_by: null,
  released_at: null,
  release_reason: null,
  expires_at: null,
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
  can_view_evidence_summary: true,
  can_view_evidence_room: true,
  can_download_compiled_pack: true,
  can_view_raw_documents: false,
  can_download_raw_documents: false,
  can_view_unmasked_sensitive_details: false,
  buyer_consent_status: "granted",
  seller_consent_status: "granted",
  admin_override_reason: null,
  created_at: "",
  updated_at: "",
};

const pack: PackVersionRow = {
  id: "p1",
  release_id: "r1",
  pack_id: "pk1",
  version: 1,
  status: "sealed",
  storage_bucket: "funder-evidence-packs",
  storage_path: "f1/r1/v1.pdf",
  file_sha256: "a".repeat(64),
  manifest_sha256: null,
  generated_at: "",
  sealed_at: "",
  download_expires_at: null,
  created_at: "",
  updated_at: "",
};

describe("release-state SSOT", () => {
  it("effective status collapses expired-in-past to expired even if DB says active", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(
      effectiveReleaseStatus({ release_status: "active", expires_at: past }),
    ).toBe("expired");
  });

  it("flags expiring_soon within 14 days", () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      effectiveReleaseStatus({ release_status: "active", expires_at: soon }),
    ).toBe("expiring_soon");
    expect(isReleaseUsable({ release_status: "active", expires_at: soon })).toBe(true);
  });

  it("consentSatisfied requires both parties OR an override reason", () => {
    expect(consentSatisfied(base)).toBe(true);
    expect(
      consentSatisfied({ ...base, buyer_consent_status: "pending" }),
    ).toBe(false);
    expect(
      consentSatisfied({
        ...base,
        buyer_consent_status: "pending",
        admin_override_reason: "regulator directive #42",
      }),
    ).toBe(true);
  });

  it("canGenerateSealedPack mirrors server-side gates", () => {
    expect(canGenerateSealedPack(base).ok).toBe(true);
    expect(canGenerateSealedPack({ ...base, release_status: "draft" }).ok).toBe(false);
    expect(canGenerateSealedPack({ ...base, release_status: "revoked" }).ok).toBe(false);
    expect(
      canGenerateSealedPack({ ...base, buyer_consent_status: "pending" }).ok,
    ).toBe(false);
    expect(
      canGenerateSealedPack({
        ...base,
        buyer_consent_status: "pending",
        admin_override_reason: "override",
      }).ok,
    ).toBe(true);
  });

  it("packDownloadReadiness agrees on admin + funder surfaces", () => {
    expect(packDownloadReadiness(base, pack).ready).toBe(true);

    // Missing storage bytes ⇒ funder sees "Not available", admin sees "No"
    expect(
      packDownloadReadiness(base, { ...pack, storage_path: null }).ready,
    ).toBe(false);

    // Permission off ⇒ neither surface offers download
    expect(
      packDownloadReadiness({ ...base, can_download_compiled_pack: false }, pack).ready,
    ).toBe(false);

    // Expired release ⇒ download blocked
    const past = new Date(Date.now() - 1000).toISOString();
    expect(
      packDownloadReadiness({ ...base, expires_at: past }, pack).ready,
    ).toBe(false);

    // Pending pack ⇒ blocked
    expect(
      packDownloadReadiness(base, { ...pack, status: "pending" }).ready,
    ).toBe(false);
  });

  it("badge variants + labels are stable (shared by both surfaces)", () => {
    expect(statusBadgeVariant("active")).toBe("default");
    expect(statusBadgeVariant("revoked")).toBe("destructive");
    expect(statusBadgeVariant("expiring_soon")).toBe("outline");
    expect(statusLabel("expiring_soon")).toBe("expiring soon");
    expect(statusLabel("active")).toBe("active");
  });
});
