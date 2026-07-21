/**
 * Funder Workspace dashboard metrics — client-side derivation SSOT.
 *
 * Covers the rules from the metrics audit:
 *  - Active includes expiring-soon (warning subset).
 *  - Expiring-soon excludes already-expired.
 *  - Revoked / expired never count as Active.
 *  - Null expiry ⇒ Active.
 *  - Boundary handling at now and now+14d.
 *  - Timezone independence (UTC-anchored ISO strings; helpers are
 *    epoch-ms based, so callers cannot vary results by TZ).
 */
import { describe, it, expect } from "vitest";
import {
  activeReleases,
  computeReleaseMetrics,
  expiringSoonReleases,
} from "@/lib/funder-workspace/metrics";
import type { DealReleaseRow } from "@/lib/funder-workspace/types";

const NOW = Date.parse("2026-07-21T00:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const DAY = 24 * 60 * 60 * 1000;

const base: DealReleaseRow = {
  id: "r",
  funder_organisation_id: "o",
  deal_reference: "D",
  evidence_pack_id: null,
  evidence_pack_version: null,
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
  match_id: null,
  deal_linkage_status: null,
  deal_linked_at: null,
  deal_linked_by: null,
  deal_linkage_reason: null,
  created_at: "",
  updated_at: "",
};

const mk = (over: Partial<DealReleaseRow>): DealReleaseRow => ({ ...base, ...over });

describe("funder-workspace client-side metrics", () => {
  it("counts an active release far in the future as Active only", () => {
    const rows = [mk({ id: "a", expires_at: iso(NOW + 30 * DAY) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(1);
    expect(m.expiring_soon).toBe(0);
  });

  it("counts an active release expiring in 10 days as BOTH Active and Expiring soon", () => {
    const rows = [mk({ id: "b", expires_at: iso(NOW + 10 * DAY) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(1);
    expect(m.expiring_soon).toBe(1);
    expect(activeReleases(rows, NOW)).toHaveLength(1);
    expect(expiringSoonReleases(rows, NOW)).toHaveLength(1);
  });

  it("does not count a release expiring in 15 days as Expiring soon", () => {
    const rows = [mk({ id: "c", expires_at: iso(NOW + 15 * DAY) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(1);
    expect(m.expiring_soon).toBe(0);
  });

  it("does not count an already-expired release as Active or Expiring soon (even if release_status='active')", () => {
    const rows = [mk({ id: "d", expires_at: iso(NOW - 1) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(0);
    expect(m.expiring_soon).toBe(0);
    expect(m.expired).toBe(1);
  });

  it("excludes revoked releases from Active", () => {
    const rows = [mk({ id: "e", release_status: "revoked", expires_at: iso(NOW + 5 * DAY) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(0);
    expect(m.revoked).toBe(1);
    expect(m.expiring_soon).toBe(0);
  });

  it("null expiry ⇒ counts as Active, never as Expiring soon", () => {
    const rows = [mk({ id: "f", expires_at: null })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(1);
    expect(m.expiring_soon).toBe(0);
  });

  it("boundary: expiry exactly at now ⇒ expired", () => {
    const rows = [mk({ id: "g", expires_at: iso(NOW) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.expired).toBe(1);
    expect(m.expiring_soon).toBe(0);
  });

  it("boundary: expiry exactly at now + 14d ⇒ still Active (strict-less-than window)", () => {
    // Matches existing effectiveReleaseStatus() rule (< 14 days).
    const rows = [mk({ id: "h", expires_at: iso(NOW + 14 * DAY) })];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.active).toBe(1);
    expect(m.expiring_soon).toBe(0);
  });

  it("mirrors the live pilot dataset (2 active, 1 revoked, 1 expiring-soon)", () => {
    const rows = [
      mk({ id: "A", expires_at: "2026-08-09T02:27:00Z" }),
      mk({ id: "B", expires_at: "2026-08-01T02:14:00Z" }),
      mk({ id: "C", release_status: "revoked", expires_at: "2026-09-18T12:00:00Z" }),
    ];
    const m = computeReleaseMetrics(rows, NOW);
    expect(m.total).toBe(3);
    expect(m.active).toBe(2);
    expect(m.expiring_soon).toBe(1);
    expect(m.revoked).toBe(1);
    expect(m.expired).toBe(0);
  });

  it("timezone independence: same rows counted identically regardless of TZ interpretation", () => {
    const rows = [mk({ id: "A", expires_at: "2026-08-01T02:14:00Z" })];
    // Two "now" instants an hour apart still yield the same category.
    const m1 = computeReleaseMetrics(rows, NOW);
    const m2 = computeReleaseMetrics(rows, NOW + 60 * 60 * 1000);
    expect(m1.expiring_soon).toBe(m2.expiring_soon);
  });
});
