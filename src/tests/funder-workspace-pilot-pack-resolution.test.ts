/**
 * Controlled pilot blocker: the release form must resolve evidence packs from
 * the selected canonical deal. Non-technical pilot testers must never enter
 * pack UUIDs or arbitrary versions by hand.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

function findMigration(needle: string): string {
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith(".sql")).reverse()) {
    const src = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (src.includes(needle)) return src;
  }
  throw new Error(`No migration contains: ${needle}`);
}

describe("controlled pilot — evidence pack resolution", () => {
  const migration = findMigration("fw_admin_list_eligible_evidence_packs_v1");
  const form = readFileSync("src/pages/admin/funder-workspace/NewRelease.tsx", "utf8");
  const client = readFileSync("src/lib/funder-workspace/admin-client.ts", "utf8");
  const pilot = readFileSync("src/pages/admin/funder-workspace/PilotConsole.tsx", "utf8");

  it("adds a server-backed, deal-scoped eligible pack resolver", () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.fw_admin_list_eligible_evidence_packs_v1/);
    expect(migration).toMatch(/WHERE p\.match_id = p_match_id/);
    expect(migration).toMatch(/p\.pack_status IN \('sealed', 'generated'\)/);
    expect(migration).toMatch(/p\.superseded_by IS NULL/);
    expect(migration).toMatch(/pi\.snapshot_status IN \('accepted', 'accepted_with_warning'\)/);
    expect(migration).toMatch(/Evidence Pack — Version/);
  });

  it("release RPC rejects unrelated or ineligible packs", () => {
    expect(migration).toMatch(/FROM public\.fw_admin_list_eligible_evidence_packs_v1\(p_match_id\) ep/);
    expect(migration).toMatch(/ep\.evidence_pack_id = p_evidence_pack_id/);
    expect(migration).toMatch(/ep\.evidence_pack_version = trim\(p_evidence_pack_version\)/);
    expect(migration).toMatch(/selected evidence pack is not available for this canonical deal/);
  });

  it("admin client exposes the resolver and allow-lists the RPC", () => {
    expect(client).toMatch(/listEligibleEvidencePacks/);
    expect(client).toMatch(/fw_admin_list_eligible_evidence_packs_v1/);
  });

  it("release form resolves packs after canonical deal selection", () => {
    expect(form).toMatch(/listEligibleEvidencePacks/);
    expect(form).toMatch(/queryKey: \["fw-eligible-packs"/);
    expect(form).toMatch(/packs\.length === 1/);
    expect(form).toMatch(/fw-release-auto-pack/);
    expect(form).toMatch(/fw-release-pack-selector/);
  });

  it("missing pack shows the required non-technical message", () => {
    expect(form).toContain("No evidence pack is available for this deal yet. Create or prepare the evidence pack before releasing the deal.");
    expect(form).toMatch(/fw-release-no-pack/);
  });

  it("does not render raw pack UUID or version text inputs", () => {
    expect(form).not.toMatch(/Evidence pack ID \(UUID\)/);
    expect(form).not.toMatch(/htmlFor="pack-id"/);
    expect(form).not.toMatch(/htmlFor="pack-ver"/);
    expect(form).not.toMatch(/placeholder="00000000-0000-0000-0000-000000000000"/);
  });

  it("pilot guide verifies the seeded demo deal has an eligible pack", () => {
    expect(pilot).toMatch(/Eligible synthetic evidence pack/);
    expect(pilot).toMatch(/Evidence Pack — Version 1/);
    expect(pilot).toMatch(/selected automatically/);
  });
});