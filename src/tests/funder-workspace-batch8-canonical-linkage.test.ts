/**
 * Institutional Funder Evidence Workspace — Batch 8
 * Static tests for canonical deal linkage: migration shape, RPC allow-list,
 * projection linkage-mode wiring, admin selector/link-to-match UI wiring,
 * and evidence-completeness honest wording.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

function findMigration(needle: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  for (const f of files) {
    const p = join(MIGRATIONS_DIR, f);
    const src = readFileSync(p, "utf8");
    if (src.includes(needle)) return src;
  }
  throw new Error(`No migration contains: ${needle}`);
}

describe("Batch 8 — canonical deal linkage migration", () => {
  const sql = findMigration("fw_admin_release_deal_v2");

  it("adds additive linkage columns to funder_deal_releases", () => {
    expect(sql).toMatch(/ALTER TABLE public\.funder_deal_releases/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS match_id uuid REFERENCES public\.matches\(id\)/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS deal_linkage_status text/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS deal_linked_at timestamptz/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS deal_linked_by uuid/);
  });

  it("indexes match_id for join performance", () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS funder_deal_releases_match_id_idx/);
  });

  it("safely backfills legacy releases where deal_reference is a real match UUID", () => {
    expect(sql).toMatch(/UPDATE public\.funder_deal_releases[\s\S]*deal_linkage_status = 'legacy_fallback'/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.matches m WHERE m\.id = r\.deal_reference::uuid\)/);
    expect(sql).toMatch(/deal_linkage_status = 'legacy_unresolved'/);
  });

  it("defines V2 release RPC requiring a canonical match_id", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_release_deal_v2/);
    expect(sql).toMatch(/canonical deal \(match_id\) required/);
    expect(sql).toMatch(/canonical deal not found/);
    expect(sql).toMatch(/'canonical'/);
    expect(sql).toMatch(/p5b3_is_platform_admin/);
    expect(sql).toMatch(/fw_is_funder_org_approved_v1/);
    expect(sql).toMatch(/fw.consent_required/);
  });

  it("defines admin-only searchable deal selector with bounded results and safe fields", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_search_releasable_deals_v1/);
    expect(sql).toMatch(/least\(greatest\(coalesce\(p_limit,25\), 1\), 100\)/);
    // Must NOT return raw documents / bank details / verification payloads
    expect(sql).not.toMatch(/storage_path/);
    expect(sql).not.toMatch(/raw_bank/);
    expect(sql).toMatch(/RETURNS TABLE\(\s*match_id uuid/);
  });

  it("defines admin-only manual linkage RPC with required reason and audit", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_link_release_to_match_v1/);
    expect(sql).toMatch(/linkage reason required/);
    expect(sql).toMatch(/already canonically linked/);
    expect(sql).toMatch(/funder_deal\.linked_to_match/);
  });

  it("updated pack-content projection prefers canonical match_id and reports linkage_mode", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_funder_pack_content_v1/);
    expect(sql).toMatch(/IF v_r\.match_id IS NOT NULL THEN/);
    expect(sql).toMatch(/'linkage_mode'/);
    expect(sql).toMatch(/'canonical'|'legacy_fallback'|'unresolved'|'invalid'/);
    // honest evidence-completeness wording
    expect(sql).toMatch(/A complete required-evidence checklist has not been configured/);
    // honest finality wording
    expect(sql).toMatch(/No finality record is linked to this transaction/);
    // honest bank-confidence wording preserved
    expect(sql).toMatch(/No authoritative bank-confidence assessment is configured/);
  });

  it("EXECUTE is locked to authenticated and service_role for every new RPC", () => {
    for (const fn of [
      "fw_admin_release_deal_v2",
      "fw_admin_search_releasable_deals_v1",
      "fw_admin_link_release_to_match_v1",
    ]) {
      expect(sql).toContain(`REVOKE EXECUTE ON FUNCTION public.${fn}`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`);
    }
  });
});

describe("Batch 8 — admin client wiring", () => {
  const src = readFileSync("src/lib/funder-workspace/admin-client.ts", "utf8");

  it("exposes createReleaseV2 / searchReleasableDeals / linkReleaseToMatch", () => {
    expect(src).toMatch(/export async function createReleaseV2/);
    expect(src).toMatch(/export async function searchReleasableDeals/);
    expect(src).toMatch(/export async function linkReleaseToMatch/);
  });

  it("lists new RPCs in the admin allow-list and preserves V1", () => {
    expect(src).toMatch(/"fw_admin_release_deal_v1"/);
    expect(src).toMatch(/"fw_admin_release_deal_v2"/);
    expect(src).toMatch(/"fw_admin_search_releasable_deals_v1"/);
    expect(src).toMatch(/"fw_admin_link_release_to_match_v1"/);
  });
});

describe("Batch 8 — NewRelease UI uses the canonical selector, not free text", () => {
  const src = readFileSync("src/pages/admin/funder-workspace/NewRelease.tsx", "utf8");

  it("imports and renders CanonicalDealSelector", () => {
    expect(src).toMatch(/CanonicalDealSelector/);
  });

  it("submits via createReleaseV2 (not V1)", () => {
    expect(src).toMatch(/createReleaseV2\(/);
    expect(src).not.toMatch(/createRelease\(/);
  });

  it("no longer renders the free-text deal-reference input", () => {
    expect(src).not.toMatch(/data-testid="fw-release-deal-ref"/);
  });
});

describe("Batch 8 — ReleaseDetail exposes linkage and manual linking", () => {
  const src = readFileSync("src/pages/admin/funder-workspace/ReleaseDetail.tsx", "utf8");

  it("shows the linkage badge and legacy-linking action", () => {
    expect(src).toMatch(/fw-admin-release-linkage/);
    expect(src).toMatch(/fw-admin-link-canonical/);
    expect(src).toMatch(/linkReleaseToMatch/);
  });

  it("blocks pack generation when linkage is unresolved/invalid", () => {
    expect(src).toMatch(/Pack generation is blocked/);
    expect(src).toMatch(/requiresLegacyLinking/);
  });
});

describe("Batch 8 — funder-pack-generate blocks unresolved/invalid linkage", () => {
  const src = readFileSync("supabase/functions/funder-pack-generate/index.ts", "utf8");

  it("returns linkage_required when the projection reports no canonical link", () => {
    expect(src).toMatch(/linkage_required/);
    expect(src).toMatch(/linkage_mode === "unresolved" \|\| linkageMode === "invalid"|linkageMode === "unresolved" \|\| linkageMode === "invalid"/);
  });
});
