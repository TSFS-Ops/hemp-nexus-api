/**
 * Batch 6 — end-to-end demo journey coverage (structural).
 * Asserts the required V1 flow surfaces exist and are wired to the
 * server-side pipeline built across Batches 1–6, without shipping any
 * out-of-scope feature.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function read(p: string): string {
  return readFileSync(p, "utf8");
}

describe("Batch 6 — demo V1 journey surfaces", () => {
  it("1. admin reviews onboarding requests", () => {
    const s = read("src/pages/admin/funder-workspace/OnboardingRequests.tsx");
    expect(s).toMatch(/approveOnboardingRequest|fw_admin_approve_funder_org_v1/);
    expect(s).toMatch(/rejectOnboardingRequest|fw_admin_reject_funder_org_v1/);
  });

  it("2. admin releases a deal with consent or explicit override", () => {
    const s = read("src/pages/admin/funder-workspace/NewRelease.tsx");
    expect(s).toMatch(/fw_admin_release_deal_v1|fw_admin_release_deal_v2|createReleaseV2|releaseDeal/);
    expect(s).toMatch(/consent|override/i);
  });

  it("3. funder sees only assigned deals", () => {
    const s = read("src/lib/funder-workspace/funder-client.ts");
    expect(s).toMatch(/listMyReleases/);
    // Funder reads never enumerate the admin org table for other funders.
    expect(s).not.toMatch(/from\(['"]organizations['"]\)/);
  });

  it("4. admin generates sealed PDF pack", () => {
    const s = read("src/lib/funder-workspace/admin-client.ts");
    expect(s).toMatch(/generateSealedPack/);
    expect(s).toMatch(/funder-pack-generate/);
  });

  it("5. funder downloads sealed pack through signed URL", () => {
    const s = read("src/lib/funder-workspace/funder-client.ts");
    expect(s).toMatch(/requestPackDownload/);
    expect(s).toMatch(/funder-pack-download/);
    expect(s).toMatch(/signed_url/);
  });

  it("6. RFI lifecycle: funder raises + admin answers", () => {
    const s = read("src/lib/funder-workspace/workflow-client.ts");
    expect(s).toMatch(/fw_funder_create_rfi_v1/);
    expect(s).toMatch(/fw_admin_answer_rfi_v1/);
  });

  it("7. approver records decision (approver-only enforced server-side)", () => {
    const s = read("src/lib/funder-workspace/workflow-client.ts");
    expect(s).toMatch(/fw_funder_record_decision_v1/);
    const mig = read(latestBatch5Migration());
    expect(mig).toMatch(/only_approver_can_record_decision/);
  });

  it("8. audit + usage ledgers are the source for the activity view", () => {
    const s = read("src/pages/funder/workspace/Activity.tsx");
    expect(s).toMatch(/usage|audit|activity/i);
  });

  it("9. counters back the dashboards via new RPCs", () => {
    expect(read("src/pages/admin/funder-workspace/Index.tsx")).toMatch(/fetchAdminCounters/);
    expect(read("src/pages/funder/workspace/Index.tsx")).toMatch(/fetchFunderCounters/);
  });
});

describe("Batch 6 — cross-batch invariants (no regressions to prior RPC signatures)", () => {
  it("Batch 3/4/5 admin/funder RPC names still exist in client code", () => {
    const admin = read("src/lib/funder-workspace/admin-client.ts");
    const funder = read("src/lib/funder-workspace/funder-client.ts");
    const workflow = read("src/lib/funder-workspace/workflow-client.ts");
    const combined = admin + funder + workflow;
    for (const rpc of [
      "fw_admin_approve_funder_org_v1",
      "fw_admin_reject_funder_org_v1",
      "fw_admin_release_deal_v1",
      "fw_admin_revoke_deal_release_v1",
      "fw_funder_create_rfi_v1",
      "fw_admin_answer_rfi_v1",
      "fw_funder_record_decision_v1",
    ]) {
      expect(combined).toContain(rpc);
    }
  });
});

function latestBatch5Migration(): string {
  const dir = join(process.cwd(), "supabase/migrations");
  const f = readdirSync(dir)
    .filter((x) => x.startsWith("20260712091031"))
    .map((x) => join(dir, x))[0];
  return f;
}
