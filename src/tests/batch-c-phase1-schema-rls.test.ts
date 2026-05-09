/**
 * Batch C Phase 1 — static schema/RLS/labels assertion suite.
 *
 * Phase 1 scope: schema + RLS + static tests only.
 * NO behaviour wiring (no RPC, no edge function, no UI, no notifications,
 * no rating emission). Tests below are intentionally static — they
 * validate the migration shipped in
 * supabase/migrations/2026...match_challenges_phase1.
 *
 * Live DB assertions are deferred to Phase 2 (RPC behaviour tests).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  CHALLENGE_OUTCOME_CODES,
  CHALLENGE_OUTCOME_LABELS,
  CHALLENGE_STATUSES,
  CHALLENGE_SUBJECT_CODES,
} from "@/lib/challenge-outcomes";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../supabase/migrations");

function readAllMigrations(): string {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  return files.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")).join("\n");
}

const ALL_SQL = readAllMigrations();

// Locate the Phase 1 challenges migration text specifically so we can
// assert intent on the founding migration without hitting unrelated SQL.
const PHASE1_MIGRATION_TEXT = (() => {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const matches = files
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"))
    .filter((sql) => /CREATE TABLE\s+public\.match_challenges\b/i.test(sql));
  if (matches.length === 0) {
    throw new Error("Phase 1 match_challenges migration not found");
  }
  return matches.join("\n");
})();

describe("Batch C Phase 1 — schema (migration text)", () => {
  it("creates match_challenges, match_challenge_comments, match_challenge_evidence", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/CREATE TABLE\s+public\.match_challenges\b/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/CREATE TABLE\s+public\.match_challenge_comments\b/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/CREATE TABLE\s+public\.match_challenge_evidence\b/i);
  });

  it("declares the closed status, subject_code and outcome_code lists", () => {
    for (const s of CHALLENGE_STATUSES) {
      expect(PHASE1_MIGRATION_TEXT).toContain(`'${s}'`);
    }
    for (const s of CHALLENGE_SUBJECT_CODES) {
      expect(PHASE1_MIGRATION_TEXT).toContain(`'${s}'`);
    }
    for (const o of CHALLENGE_OUTCOME_CODES) {
      expect(PHASE1_MIGRATION_TEXT).toContain(`'${o}'`);
    }
  });

  it("constrains role columns to the three roles", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /raised_by_role.*CHECK\s*\(raised_by_role\s+IN\s*\('buyer_org_admin','seller_org_admin','platform_admin'\)\)/is,
    );
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /author_role.*CHECK\s*\(author_role\s+IN\s*\('buyer_org_admin','seller_org_admin','platform_admin'\)\)/is,
    );
  });

  it("constrains text/file lengths to the locked limits", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/char_length\(summary\)\s+BETWEEN\s+20\s+AND\s+2000/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/char_length\(body\)\s+BETWEEN\s+5\s+AND\s+4000/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/char_length\(outcome_summary\)\s*>=\s*40/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/size_bytes\s*<=\s*26214400/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/char_length\(sha256\)\s*=\s*64/i);
  });

  it("creates the partial unique index for one non-terminal challenge per match", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /CREATE UNIQUE INDEX\s+uniq_match_challenge_open_per_match[\s\S]+?WHERE\s+status\s+IN\s*\('open','under_review'\)/i,
    );
  });

  it("declares the immutable-fields trigger and the state-machine trigger", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/CREATE TRIGGER\s+trg_match_challenges_immutable_fields/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/CREATE TRIGGER\s+trg_match_challenges_state_machine/i);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/match_id is immutable/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/raised_by_org_id is immutable/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/raised_by_user_id is immutable/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/raised_by_role is immutable/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/subject_code is immutable/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/summary is immutable/);
  });

  it("enforces state-machine rules in the trigger body", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/is terminal and cannot transition/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/invalid transition open ->/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/invalid transition under_review ->/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /outcome_recorded requires a valid outcome_code \(not withdrawn_by_raiser\)/,
    );
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /outcome_recorded requires outcome_summary of at least 40 characters/,
    );
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /withdrawn rows must use outcome_code = withdrawn_by_raiser/,
    );
  });

  it("declares the table-level outcome integrity CHECK constraints", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/match_challenges_outcome_recorded_requires_code/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/match_challenges_closed_no_action_requires_summary/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/match_challenges_withdrawn_uses_withdrawn_outcome/);
  });
});

describe("Batch C Phase 1 — RLS shape", () => {
  it("enables RLS on all three new tables", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /ALTER TABLE\s+public\.match_challenges\s+ENABLE ROW LEVEL SECURITY/i,
    );
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /ALTER TABLE\s+public\.match_challenge_comments\s+ENABLE ROW LEVEL SECURITY/i,
    );
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /ALTER TABLE\s+public\.match_challenge_evidence\s+ENABLE ROW LEVEL SECURITY/i,
    );
  });

  it("creates SELECT policies for participants and INSERT policies for org_admins/platform_admin", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/POLICY\s+"challenges_select_participants"/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/POLICY\s+"challenges_insert_party_admins_or_platform"/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/POLICY\s+"challenge_comments_select_participants"/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /POLICY\s+"challenge_comments_insert_party_admins_or_platform"/,
    );
    expect(PHASE1_MIGRATION_TEXT).toMatch(/POLICY\s+"challenge_evidence_select_participants"/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /POLICY\s+"challenge_evidence_insert_party_admins_or_platform"/,
    );
  });

  it("does NOT create any UPDATE or DELETE policies on match_challenges (service role only)", () => {
    // No CREATE POLICY ... ON public.match_challenges ... FOR UPDATE / DELETE
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(
      /CREATE POLICY[^;]+ON\s+public\.match_challenges[^;]+FOR\s+UPDATE/i,
    );
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(
      /CREATE POLICY[^;]+ON\s+public\.match_challenges[^;]+FOR\s+DELETE/i,
    );
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(
      /CREATE POLICY[^;]+ON\s+public\.match_challenge_comments[^;]+FOR\s+(UPDATE|DELETE)/i,
    );
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(
      /CREATE POLICY[^;]+ON\s+public\.match_challenge_evidence[^;]+FOR\s+(UPDATE|DELETE)/i,
    );
  });

  it("uses is_org_admin() for party-admin checks (not membership only)", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/is_match_party_org_admin\(auth\.uid\(\),\s*match_id\)/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/is_org_admin\(auth\.uid\(\),\s*raised_by_org_id\)/);
  });

  it("creates the private storage bucket and storage policies", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(/'match-challenge-evidence'/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/POLICY\s+"challenge_evidence_storage_select"/);
    expect(PHASE1_MIGRATION_TEXT).toMatch(/POLICY\s+"challenge_evidence_storage_insert"/);
  });
});

describe("Batch C Phase 1 — settings flag (no emission code)", () => {
  it("seeds challenge_rating_impact admin setting to disabled", () => {
    expect(PHASE1_MIGRATION_TEXT).toMatch(
      /admin_settings[\s\S]+?'challenge_rating_impact'[\s\S]+?"enabled":\s*false/,
    );
  });

  it("ships NO rating-signal emission code referencing challenges in src/ or supabase/functions/", () => {
    function walk(dir: string, acc: string[] = []): string[] {
      if (!fs.existsSync(dir)) return acc;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(full, acc);
        } else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
          acc.push(full);
        }
      }
      return acc;
    }
    const files = [
      ...walk(path.resolve(__dirname, "..")),
      ...walk(path.resolve(__dirname, "../../supabase/functions")),
    ];
    const offenders = files.filter((f) => {
      // Skip this very test file
      if (f.endsWith("batch-c-phase1-schema-rls.test.ts")) return false;
      const sql = fs.readFileSync(f, "utf8");
      return (
        /challenge[_-]?rating[_-]?impact/i.test(sql) ||
        /emit.*rating.*challenge/i.test(sql) ||
        /rating_signals?\s*\.\s*insert.*challenge/i.test(sql)
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe("Batch C Phase 1 — legacy disputes untouched", () => {
  it("the Phase 1 migration does not touch public.disputes", () => {
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(/\bpublic\.disputes\b/);
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(/ALTER TABLE\s+public\.disputes/i);
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(/DROP\s+TABLE\s+public\.disputes/i);
  });

  it("legacy disputes migration files and Journey 3 tests still exist on disk", () => {
    const journey3 = path.resolve(
      __dirname,
      "../../src/tests/uat/journey-3-disputes.test.ts",
    );
    expect(fs.existsSync(journey3)).toBe(true);

    // Original disputes table creation must still be present in the historical migration set.
    expect(ALL_SQL).toMatch(/CREATE TABLE\s+(public\.)?disputes\b/i);
  });
});

describe("Batch C Phase 1 — outcome label catalogue", () => {
  it("centralises the user-facing labels with no fault/blame wording", () => {
    const forbidden = /(fault|blame|guilty|liable|fraud|upheld|not\s*upheld|accus|winner|loser)/i;
    for (const code of CHALLENGE_OUTCOME_CODES) {
      const label = CHALLENGE_OUTCOME_LABELS[code];
      expect(label, `label for ${code}`).toBeTruthy();
      expect(label).not.toMatch(forbidden);
    }
  });

  it("matches the locked label text exactly", () => {
    expect(CHALLENGE_OUTCOME_LABELS.no_action_required).toBe("No action required");
    expect(CHALLENGE_OUTCOME_LABELS.corrected_and_proceed).toBe(
      "Corrected — trade may proceed",
    );
    expect(CHALLENGE_OUTCOME_LABELS.withdrawn_by_raiser).toBe("Challenge withdrawn");
    expect(CHALLENGE_OUTCOME_LABELS.superseded_by_updated_terms).toBe(
      "Superseded by updated terms",
    );
    expect(CHALLENGE_OUTCOME_LABELS.evidence_required).toBe("Further evidence required");
    expect(CHALLENGE_OUTCOME_LABELS.cannot_proceed).toBe("Match cannot proceed");
    expect(CHALLENGE_OUTCOME_LABELS.admin_override_recorded).toBe(
      "Admin override recorded",
    );
  });

  it("the Phase 1 migration contains no fault/blame wording in comments or labels", () => {
    const forbidden = /(\bfault\b|\bblame\b|\bguilty\b|\bliable\b|\bfraud\b|\bupheld\b|\baccus\w+\b|\bwinner\b|\bloser\b)/i;
    expect(PHASE1_MIGRATION_TEXT).not.toMatch(forbidden);
  });
});
