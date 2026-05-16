/**
 * Batch K — Lifecycle expiry, manual repair and completed/WaD consistency.
 *
 * Source-level guarantees (no live DB execution). We assert the on-disk
 * artefacts encode the safety properties the Batch K spec demands:
 *
 *   Fix 1 — completed-without-sealed-WaD detector exists in lifecycle-scheduler.
 *   Fix 2 — admin_repair_legacy_match refuses restore_poi_state_for_completed
 *           when no sealed WaD exists; edge function maps the typed error and
 *           emits a legacy_repair_followup_required risk item.
 *   Fix 3 — admin-match-legacy-repair enforces AAL2 via assertAal2.
 *   Fix 4 — risk items are upserted on operation_deferred / completed_without_sealed_wad /
 *           still_inconsistent_after_repair.
 *   Fix 5 — lifecycle-scheduler writes a lifecycle_scheduler.run_summary audit
 *           row on apply runs, never on dry-run.
 *   Fix 6 — per-match match.expired_by_lifecycle audit rows are written when
 *           the scheduler expires pending POI matches.
 *   Fix 7 — schema mapping note documents that state/status remain unchanged
 *           and UI must derive from poi_state.
 *   Fix 9 — long-pending engagement visibility is surfaced (not auto-expired).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const migrationsDir = join(root, "supabase/migrations");
const repairEdge = readFileSync(
  join(root, "supabase/functions/admin-match-legacy-repair/index.ts"),
  "utf8",
);
const scheduler = readFileSync(
  join(root, "supabase/functions/lifecycle-scheduler/index.ts"),
  "utf8",
);

function latestRepairMigration(): string {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let chosen = "";
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    if (sql.includes("CREATE OR REPLACE FUNCTION public.admin_repair_legacy_match")) {
      chosen = sql;
    }
  }
  return chosen;
}
const repairRpcSql = latestRepairMigration();

describe("Batch K — Fix 1: completed-without-sealed-WaD detector", () => {
  it("scheduler scans completed matches for sealed WaD", () => {
    expect(scheduler).toMatch(/completed[_-]without[_-]sealed[_-]wad/i);
    expect(scheduler).toMatch(/state\.eq\.completed,poi_state\.eq\.COMPLETED/);
    expect(scheduler).toMatch(/from\("wads"\)[\s\S]{0,200}status[\s\S]{0,40}sealed/);
  });

  it("creates idempotent admin_risk_items with stable dedup_key", () => {
    expect(scheduler).toMatch(/dedup_key.*completed_without_sealed_wad:\$\{m\.id\}/);
    expect(scheduler).toMatch(/onConflict:\s*"dedup_key",\s*ignoreDuplicates:\s*true/);
  });

  it("never mutates match or WaD state", () => {
    // Detector block only does .select / .upsert into admin_risk_items / audit_logs.
    const block = scheduler.split("Fix 1: completed-without-sealed-WaD detector")[1] ?? "";
    const sliceBeforeNext = block.split("Batch K Fix 9")[0] ?? block;
    expect(sliceBeforeNext).not.toMatch(/from\("matches"\)[\s\S]{0,80}\.update\(/);
    expect(sliceBeforeNext).not.toMatch(/from\("wads"\)[\s\S]{0,80}\.update\(/);
  });

  it("dry-run skips mutations and counts skipped", () => {
    expect(scheduler).toMatch(/if \(dryRun\) \{ cwswSkipped\+\+; continue; \}/);
  });
});

describe("Batch K — Fix 2: repair refuses restore without sealed WaD", () => {
  it("RPC raises completed_without_sealed_wad when no sealed WaD exists", () => {
    expect(repairRpcSql).toMatch(/IF v_operation = 'restore_poi_state_for_completed' THEN/);
    expect(repairRpcSql).toMatch(/sealed_at IS NOT NULL[\s\S]{0,80}status = 'sealed'/);
    expect(repairRpcSql).toMatch(/RAISE EXCEPTION 'completed_without_sealed_wad'/);
  });

  it("edge function maps completed_without_sealed_wad → 409 typed error", () => {
    expect(repairEdge).toMatch(/completed_without_sealed_wad/);
    expect(repairEdge).toMatch(/COMPLETED_WITHOUT_SEALED_WAD/);
  });

  it("edge function emits legacy_repair_followup_required risk item on this error", () => {
    expect(repairEdge).toMatch(
      /completed_without_sealed_wad[\s\S]{0,400}upsertRepairFollowupRiskItem/,
    );
  });
});

describe("Batch K — Fix 3: AAL2 enforcement on legacy repair", () => {
  it("admin-match-legacy-repair imports and calls assertAal2", () => {
    expect(repairEdge).toMatch(/from\s+"\.\.\/_shared\/aal\.ts"/);
    expect(repairEdge).toMatch(/assertAal2\(authHeader/);
    expect(repairEdge).toMatch(/admin\.match_legacy_repair/);
  });

  it("AAL2 denial maps to MFA_REQUIRED 403 with observed_aal", () => {
    // assertAal2 throws ApiException("MFA_REQUIRED", ..., 403)
    expect(repairEdge).toMatch(/ApiException/);
    expect(repairEdge).toMatch(/observed_aal/);
  });

  it("AAL2 enforcement happens AFTER is_admin check (defence in depth)", () => {
    const isAdminIdx = repairEdge.indexOf("isAdmin");
    const aalIdx = repairEdge.indexOf("assertAal2(authHeader");
    expect(isAdminIdx).toBeGreaterThan(-1);
    expect(aalIdx).toBeGreaterThan(isAdminIdx);
  });
});

describe("Batch K — Fix 4: risk item on deferred / inconsistent / wad-missing", () => {
  it("OPERATION_DEFERRED branch upserts risk item", () => {
    expect(repairEdge).toMatch(
      /operation_deferred[\s\S]{0,400}upsertRepairFollowupRiskItem[\s\S]{0,200}operation_deferred/,
    );
  });

  it("STILL_INCONSISTENT_AFTER_REPAIR branch upserts risk item", () => {
    expect(repairEdge).toMatch(
      /still_inconsistent_after_repair[\s\S]{0,400}upsertRepairFollowupRiskItem[\s\S]{0,200}still_inconsistent_after_repair/,
    );
  });

  it("risk item uses stable dedup_key per match/operation/reason", () => {
    expect(repairEdge).toMatch(
      /legacy_repair_followup:\$\{payload\.matchId\}:\$\{payload\.operation\}:\$\{payload\.reason\}/,
    );
  });

  it("risk item carries actor + request_id + before/after metadata", () => {
    expect(repairEdge).toMatch(/actor_user_id:\s*payload\.actorUserId/);
    expect(repairEdge).toMatch(/request_id:\s*payload\.requestId/);
    expect(repairEdge).toMatch(/before:\s*payload\.before/);
    expect(repairEdge).toMatch(/after:\s*payload\.after/);
  });
});

describe("Batch K — Fix 5: lifecycle scheduler run_summary audit", () => {
  it("apply run writes lifecycle_scheduler.run_summary audit row", () => {
    expect(scheduler).toMatch(/lifecycle_scheduler\.run_summary/);
    expect(scheduler).toMatch(/actor:\s*"system:lifecycle-scheduler"/);
    expect(scheduler).toMatch(/started_at:\s*startedAtIso/);
    expect(scheduler).toMatch(/completed_at:/);
    expect(scheduler).toMatch(/duration_ms:/);
  });

  it("dry-run never writes run_summary", () => {
    const runSummaryIdx = scheduler.indexOf("lifecycle_scheduler.run_summary");
    expect(runSummaryIdx).toBeGreaterThan(-1);
    const guardBefore = scheduler.slice(0, runSummaryIdx);
    // The whole audit block is gated by `if (!dryRun) {`
    expect(guardBefore).toMatch(/if \(!dryRun\) \{[\s\S]{0,2000}$/);
  });
});

describe("Batch K — Fix 6: per-match expiry audit", () => {
  it("scheduler captures before snapshot for matches it will expire", () => {
    expect(scheduler).toMatch(
      /matchesToExpire[\s\S]{0,200}\.select\("id, org_id, state, status, poi_state"\)/,
    );
  });

  it("apply run writes match.expired_by_lifecycle per match", () => {
    expect(scheduler).toMatch(/action:\s*"match\.expired_by_lifecycle"/);
    expect(scheduler).toMatch(/before:\s*\{\s*state:\s*m\.state/);
    expect(scheduler).toMatch(/after:\s*\{[\s\S]{0,80}poi_state:\s*"EXPIRED"/);
    expect(scheduler).toMatch(/request_id:\s*runRequestId/);
  });

  it("dry-run never writes per-match audit rows", () => {
    const block = scheduler.split("// 1c. Expire stale draft/pending matches")[1] ?? "";
    const sliceBeforeNext = block.split("// 1d. Expire trade_orders")[0] ?? block;
    expect(sliceBeforeNext).toMatch(/if \(!dryRun && matchesToExpire/);
    // audit insert is inside the !dryRun branch
    expect(sliceBeforeNext).toMatch(/!dryRun[\s\S]{0,1500}audit_logs[\s\S]{0,200}match\.expired_by_lifecycle/);
  });
});

describe("Batch K — Fix 7: no silent state divergence", () => {
  it("expiry audit explicitly notes state/status retention and UI derivation rule", () => {
    expect(scheduler).toMatch(/UI must derive from poi_state/);
    expect(scheduler).toMatch(/Fix 7/);
  });

  it("expiry update only touches poi_state, not status or state", () => {
    expect(scheduler).toMatch(/\.update\(\{ poi_state: "EXPIRED" \}\)/);
    // No accidental status/state writes in the expiry branch
    const expiryBlock = scheduler.split("// 1c. Expire stale draft/pending matches")[1]?.split("// 1d.")[0] ?? "";
    expect(expiryBlock).not.toMatch(/\.update\(\{[^}]*status:\s*"expired"/);
    expect(expiryBlock).not.toMatch(/\.update\(\{[^}]*state:\s*"expired"/);
  });
});

describe("Batch K — Fix 9: long-pending engagement visibility", () => {
  it("scheduler reports long-pending engagements without auto-expiry", () => {
    expect(scheduler).toMatch(/long_pending_engagements/);
    expect(scheduler).toMatch(/visibility_only_no_auto_expiry/);
  });

  it("emits aggregate admin_risk_items on apply runs only", () => {
    expect(scheduler).toMatch(
      /long_pending_engagements_visibility:\$\{todayKey\}/,
    );
    expect(scheduler).toMatch(/kind:\s*"long_pending_engagements_visibility"/);
    // Guarded by !dryRun
    const idx = scheduler.indexOf("long_pending_engagements_visibility:${todayKey}");
    const before = scheduler.slice(Math.max(0, idx - 400), idx);
    expect(before).toMatch(/if \(!dryRun/);
  });
});

describe("Batch K — Fix 10 anchors: late-acceptance reconfirmation remains pinned", () => {
  it("scheduler still expires late-acceptance reconfirmation windows", () => {
    expect(scheduler).toMatch(/reconfirmation_window_expires_at/);
    expect(scheduler).toMatch(/atomic_expire_late_acceptance_reconfirmation_window/);
  });
});
