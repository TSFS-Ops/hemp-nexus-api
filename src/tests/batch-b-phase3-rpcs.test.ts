/**
 * Batch B Phase 3 — RPC SQL pin tests.
 *
 * These tests pin the salient clauses of the Phase 3 migration so any
 * future edit to the late-acceptance / renewal RPCs is a deliberate,
 * reviewable change. Live-DB existence + grant probes were captured at
 * migration time and are documented in the Phase 3 report:
 *   • atomic_record_late_acceptance, atomic_reconfirm_late_acceptance,
 *     and atomic_decline_late_acceptance all exist; PUBLIC/anon/
 *     authenticated have no EXECUTE; service_role has EXECUTE.
 *   • atomic_engagement_transition was rewritten with the two new hard
 *     rejections (`expired_engagement_use_late_acceptance_rpc` and
 *     `late_acceptance_state_requires_dedicated_rpc`).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

function findMigrationContaining(token: string): string {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  // pick the latest file containing the token (so a future amendment is what we test).
  const matches = files.filter((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8").includes(token));
  if (matches.length === 0) throw new Error(`No migration contains token: ${token}`);
  return readFileSync(join(MIGRATIONS_DIR, matches[matches.length - 1]), "utf8");
}

describe("Batch B Phase 3 — atomic_record_late_acceptance", () => {
  const sql = findMigrationContaining("atomic_record_late_acceptance");

  it("creates the function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_record_late_acceptance/);
  });

  it("locks the engagement before any read/write", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*?SELECT \* INTO v_engagement[\s\S]*?FOR UPDATE/);
  });

  it("accepts any non-terminal prior status whose expires_at has passed (clock-based, scheduler-independent)", () => {
    // Issue 1 fix: must NOT require engagement_status = 'expired'. The
    // RPC must accept pending / notification_sent / contacted / expired
    // when expires_at < now(), and reject if expires_at is still in the
    // future.
    expect(sql).toMatch(/v_allowed_prior\s+CONSTANT text\[\]\s*:=\s*\n?\s*ARRAY\['pending','notification_sent','contacted','expired'\]/);
    expect(sql).toMatch(/NOT \(v_prev_status = ANY \(v_allowed_prior\)\)/);
    expect(sql).toMatch(/v_prev_status IN \('accepted','declined'\)/);
    expect(sql).toMatch(/now\(\) <= v_engagement\.expires_at/);
    // Regression guard: the old strict-expired check must be gone.
    expect(sql).not.toMatch(/v_engagement\.engagement_status::text <> 'expired'/);
  });

  it("records the previous status in audit metadata", () => {
    expect(sql).toMatch(/'previous_status', v_prev_status/);
    expect(sql).toMatch(/'scheduler_had_swept_to_expired', \(v_prev_status = 'expired'\)/);
  });

  it("sets the agreed late-acceptance fields atomically", () => {
    expect(sql).toMatch(/engagement_status\s*=\s*'late_acceptance_pending_initiator_reconfirmation'::engagement_status/);
    expect(sql).toMatch(/counterparty_response\s*=\s*'accepted_after_expiry'/);
    expect(sql).toMatch(/original_expired_at\s*=\s*COALESCE\(original_expired_at, expires_at\)/);
    expect(sql).toMatch(/late_acceptance_recorded_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/reconfirmation_window_expires_at\s*=\s*v_window_end/);
    expect(sql).toMatch(/v_window_end := now\(\) \+ interval '7 days'/);
  });

  it("emits the agreed audit action", () => {
    expect(sql).toContain("'pending_engagement.accepted_after_expiry'");
  });

  it("is idempotent when already in the late-acceptance state", () => {
    expect(sql).toMatch(/v_prev_status = 'late_acceptance_pending_initiator_reconfirmation'[\s\S]+'idempotent', true/);
  });

  it("is service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_record_late_acceptance[^;]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_record_late_acceptance[^;]+TO service_role/);
  });
});

describe("Batch B Phase 3 — atomic_reconfirm_late_acceptance", () => {
  const sql = findMigrationContaining("atomic_reconfirm_late_acceptance");

  it("creates the function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_reconfirm_late_acceptance/);
  });

  it("locks the parent engagement before reading or writing", () => {
    expect(sql).toMatch(/pg_advisory_xact_lock[\s\S]*?SELECT \* INTO v_parent[\s\S]*?FOR UPDATE/);
  });

  it("requires the parent to be in the reconfirmation state and within the window", () => {
    expect(sql).toMatch(/v_parent\.engagement_status::text <> 'late_acceptance_pending_initiator_reconfirmation'/);
    expect(sql).toMatch(/now\(\) > v_parent\.reconfirmation_window_expires_at/);
  });

  it("creates the renewed child as notification_sent (not accepted) with renewed_from link", () => {
    expect(sql).toMatch(/INSERT INTO poi_engagements[\s\S]+'notification_sent'::engagement_status[\s\S]+v_parent\.id/);
    expect(sql).toMatch(/renewed_from_engagement_id/);
  });

  it("sets the renewed child's expires_at EXPLICITLY to now() + 14 days (Daniel 2026-05-09)", () => {
    // The renewed child must give the trading partner exactly 14
    // calendar days to accept/decline. We pin both the column being
    // present in the INSERT list AND the literal value in the VALUES
    // clause so a regression to the 30-day column default is loud.
    const fnBody = sql.match(/CREATE OR REPLACE FUNCTION public\.atomic_reconfirm_late_acceptance[\s\S]+?\$function\$;/);
    expect(fnBody).toBeTruthy();
    const insertBlock = fnBody![0].match(/INSERT INTO poi_engagements \(([^)]+)\)\s+VALUES\s*\(([\s\S]+?)\)\s*RETURNING/);
    expect(insertBlock).toBeTruthy();
    const cols = insertBlock![1];
    const vals = insertBlock![2];
    expect(cols).toMatch(/\bexpires_at\b/);
    expect(vals).toMatch(/now\(\)\s*\+\s*interval\s*'14 days'/);
  });

  it("returns the parent to expired and records resolution metadata", () => {
    expect(sql).toMatch(/engagement_status\s*=\s*'expired'::engagement_status/);
    expect(sql).toMatch(/late_acceptance_resolution\s*=\s*'renewed_engagement_created'/);
    expect(sql).toMatch(/late_acceptance_resolved_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/reconfirmed_at\s*=\s*now\(\)/);
    expect(sql).toMatch(/reconfirmed_by_user_id\s*=\s*p_actor_user_id/);
    expect(sql).toMatch(/renewed_engagement_id\s*=\s*v_child_id/);
  });

  it("preserves counterparty_response and late_acceptance_recorded_at on the parent (no overwrite)", () => {
    // Scope to the reconfirm function body so we don't accidentally
    // match the UPDATE inside atomic_record_late_acceptance (which
    // legitimately writes counterparty_response).
    const fnBody = sql.match(/CREATE OR REPLACE FUNCTION public\.atomic_reconfirm_late_acceptance[\s\S]+?\$function\$;/);
    expect(fnBody).toBeTruthy();
    const updateBlock = fnBody![0].match(/UPDATE poi_engagements\s+SET[\s\S]+?WHERE id = p_parent_engagement_id;/);
    expect(updateBlock).toBeTruthy();
    expect(updateBlock![0]).not.toMatch(/counterparty_response\s*=/);
    expect(updateBlock![0]).not.toMatch(/late_acceptance_recorded_at\s*=/);
  });

  it("is idempotent when a renewed child already exists", () => {
    expect(sql).toMatch(/v_parent\.renewed_engagement_id IS NOT NULL[\s\S]+'idempotent', true/);
  });

  it("emits the agreed audit action", () => {
    expect(sql).toContain("'pending_engagement.reconfirmed'");
  });

  it("is service_role only (lockdown present in some migration; CREATE OR REPLACE preserves grants)", () => {
    // Postgres CREATE OR REPLACE FUNCTION preserves existing privileges,
    // so subsequent re-definitions of atomic_reconfirm_late_acceptance do
    // not need to re-emit the REVOKE/GRANT block. We assert that the
    // lockdown exists in at least one migration in the project.
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const allSql = files.map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8")).join("\n");
    expect(allSql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_reconfirm_late_acceptance[^;]+FROM PUBLIC, anon, authenticated/);
    expect(allSql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_reconfirm_late_acceptance[^;]+TO service_role/);
  });
});

describe("Batch B Phase 3 — atomic_decline_late_acceptance", () => {
  const sql = findMigrationContaining("atomic_decline_late_acceptance");

  it("creates the function", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.atomic_decline_late_acceptance/);
  });

  it("returns parent to expired and marks initiator_declined_renewal", () => {
    expect(sql).toMatch(/engagement_status\s*=\s*'expired'::engagement_status/);
    expect(sql).toMatch(/late_acceptance_resolution\s*=\s*'initiator_declined_renewal'/);
    expect(sql).toMatch(/late_acceptance_resolved_at\s*=\s*now\(\)/);
  });

  it("emits the agreed audit action", () => {
    expect(sql).toContain("'pending_engagement.initiator_declined_after_late_acceptance'");
  });

  it("is idempotent when already declined", () => {
    expect(sql).toMatch(/v_parent\.late_acceptance_resolution = 'initiator_declined_renewal'[\s\S]+'idempotent', true/);
  });

  it("is service_role only", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.atomic_decline_late_acceptance[^;]+FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.atomic_decline_late_acceptance[^;]+TO service_role/);
  });
});

describe("Batch B Phase 3 — atomic_engagement_transition hard rejections", () => {
  const sql = findMigrationContaining("expired_engagement_use_late_acceptance_rpc");

  it("rejects expired → accepted with the explicit error code", () => {
    expect(sql).toMatch(/v_prev_status = 'expired' AND p_new_status = 'accepted'[\s\S]+'expired_engagement_use_late_acceptance_rpc'/);
  });

  it("rejects any direct write into or out of late_acceptance_pending_initiator_reconfirmation", () => {
    expect(sql).toMatch(/v_prev_status = 'late_acceptance_pending_initiator_reconfirmation'\s+OR p_new_status = 'late_acceptance_pending_initiator_reconfirmation'[\s\S]+'late_acceptance_state_requires_dedicated_rpc'/);
  });
});

// ─── Issue 2 — renewed-child expires_at is now an EXPLICIT 14-day window
// (overrides the unchanged 30-day table column default) ───────────────
describe("Batch B Phase 3 — renewed child expires_at = now() + 14 days (Daniel 2026-05-09)", () => {
  it("the latest reconfirm-RPC migration sets expires_at = now() + interval '14 days'", () => {
    const sql = (() => {
      const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
      const { join } = require("node:path") as typeof import("node:path");
      const dir = join(process.cwd(), "supabase", "migrations");
      const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
      const matches = files.filter((f: string) =>
        readFileSync(join(dir, f), "utf8").includes("atomic_reconfirm_late_acceptance"),
      );
      if (!matches.length) throw new Error("atomic_reconfirm_late_acceptance migration not found");
      return readFileSync(join(dir, matches[matches.length - 1]), "utf8");
    })();
    expect(sql).toMatch(/now\(\)\s*\+\s*interval\s*'14 days'/);
    // Sanity: the legacy "rely on 30-day default" wording must no longer
    // be in the active reconfirm migration.
    expect(sql).not.toMatch(/omits expires_at on the renewed child/);
  });
});

// ─── Issue 3 — initiator authority gating ─────────────────────────────
describe("Batch B Phase 3 — initiator reconfirm/decline authority gate (Issue 3)", () => {
  const src = (() => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    return readFileSync(
      join(process.cwd(), "supabase", "functions", "poi-engagements", "index.ts"),
      "utf8",
    );
  })();

  it("requires org_admin (or platform_admin override) on the initiating org", () => {
    expect(src).toMatch(/isInitiatorOrgAdmin\s*=\s*authCtx\.roles\.includes\("org_admin"\)/);
    expect(src).toMatch(/isPlatformAdminOverride\s*=\s*authCtx\.roles\.includes\("platform_admin"\)/);
    expect(src).toMatch(/if \(!isInitiatorOrgAdmin && !isPlatformAdminOverride\)[\s\S]+?"FORBIDDEN"/);
  });

  it("still requires the caller's org to match the initiating engagement org", () => {
    expect(src).toMatch(/parent\.org_id !== authCtx\.orgId[\s\S]+?"FORBIDDEN"/);
  });

  it("emits a separately-audited record when the platform_admin override path is used", () => {
    expect(src).toContain(
      "pending_engagement.late_acceptance_resolved_via_platform_admin_override",
    );
    expect(src).toMatch(/actor_role:\s*"platform_admin"/);
  });
});

// ─── Phase 3 patch — terminal/already-recorded states are rejected at the
// route BEFORE the late-acceptance RPC is invoked. RPC hard rejections
// are kept as defence-in-depth but no longer the user-facing surface.
describe("Batch B Phase 3 patch — route-level early rejection of resolved states", () => {
  const src = (() => {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    return readFileSync(
      join(process.cwd(), "supabase", "functions", "poi-engagements", "index.ts"),
      "utf8",
    );
  })();

  it("returns ENGAGEMENT_ALREADY_ACCEPTED for accepted+expired+accept (no RPC call)", () => {
    expect(src).toMatch(/currentStatus === "accepted"[\s\S]+?"ENGAGEMENT_ALREADY_ACCEPTED"/);
  });

  it("returns ENGAGEMENT_ALREADY_DECLINED for declined+expired+accept", () => {
    expect(src).toMatch(/currentStatus === "declined"[\s\S]+?"ENGAGEMENT_ALREADY_DECLINED"/);
  });

  it("returns LATE_ACCEPTANCE_ALREADY_RECORDED for late_acceptance_pending_initiator_reconfirmation+accept", () => {
    expect(src).toMatch(
      /currentStatus === "late_acceptance_pending_initiator_reconfirmation"[\s\S]+?"LATE_ACCEPTANCE_ALREADY_RECORDED"/,
    );
  });

  it("only routes to atomic_record_late_acceptance when status is in {pending, notification_sent, contacted, expired}", () => {
    expect(src).toMatch(
      /LATE_ACCEPTANCE_ELIGIBLE_STATUSES\s*=\s*new Set\(\[\s*"pending",\s*"notification_sent",\s*"contacted",\s*"expired",?\s*\]\)/,
    );
    expect(src).toMatch(
      /LATE_ACCEPTANCE_ELIGIBLE_STATUSES\.has\(currentStatus\)[\s\S]+?atomic_record_late_acceptance/,
    );
  });

  it("keeps the RPC hard rejections in place as defence-in-depth (Phase 3 migration is unchanged)", () => {
    // The RPC still rejects accepted/declined as engagement_already_resolved.
    // We only require that the route never reaches it for those states.
    const { readFileSync, readdirSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const dir = join(process.cwd(), "supabase", "migrations");
    const files = readdirSync(dir)
      .filter((f: string) => f.endsWith(".sql"))
      .sort();
    const matches = files.filter((f: string) =>
      readFileSync(join(dir, f), "utf8").includes("atomic_record_late_acceptance"),
    );
    const sql = readFileSync(join(dir, matches[matches.length - 1]), "utf8");
    expect(sql).toMatch(/v_prev_status IN \('accepted','declined'\)/);
  });
});
