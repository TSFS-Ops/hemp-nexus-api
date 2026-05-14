/**
 * POI-012 — Source-pin tests for existing-POI idempotency and legacy drift repair.
 *
 * Pins:
 *   - Edge fast-path (`supabase/functions/match/index.ts`) calls
 *     `ensure_poi_engagement_for_minted_match` BEFORE returning 200, so
 *     legacy minted matches missing an active engagement row are repaired
 *     without burning credits or writing ledger/audit rows.
 *   - DB helper RPC (`ensure_poi_engagement_for_minted_match`) exists, is
 *     SECURITY DEFINER, has search_path locked, and is granted to
 *     service_role only (per SECDEF Stage D1).
 *   - Reconciliation (`supabase/functions/burn-poi-reconciliation/index.ts`)
 *     adds the third drift probe: minted-state-without-poi.minted-ledger-event,
 *     reports it in the response, and opens an admin_risk_item without
 *     silently mutating data.
 *   - StateProgressionCard hides the Generate POI CTA once the match has
 *     left the discovery state.
 *
 * Pure source-pin assertions (no live DB / no edge invocation), matching the
 * pattern used by poi-004 and poi-006 test suites.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO = process.cwd();

function readEdge(name: string): string {
  return readFileSync(join(REPO, 'supabase', 'functions', name, 'index.ts'), 'utf8');
}

function readSelfHealMigration(): string {
  const dir = join(REPO, 'supabase', 'migrations');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort().reverse()) {
    const txt = readFileSync(join(dir, f), 'utf8');
    if (txt.includes('CREATE OR REPLACE FUNCTION public.ensure_poi_engagement_for_minted_match')) {
      return txt;
    }
  }
  throw new Error('ensure_poi_engagement_for_minted_match migration not found');
}

describe('POI-012 — existing POI idempotency + legacy drift hardening', () => {
  // ── Fix 1: edge fast-path engagement self-heal ─────────────────────
  describe('edge fast-path self-heal (match/index.ts)', () => {
    const src = readEdge('match');

    it('still short-circuits on already-minted states', () => {
      expect(src).toMatch(
        /\['intent_declared',\s*'counterparty_sighted',\s*'committed',\s*'completed'\]\.includes\(currentState\)\s*\|\|\s*match\.status\s*===\s*'settled'/,
      );
    });

    it('calls ensure_poi_engagement_for_minted_match BEFORE returning idempotent 200', () => {
      const idx = src.indexOf("ensure_poi_engagement_for_minted_match");
      const ret = src.indexOf("POI already generated - returning idempotently");
      expect(idx).toBeGreaterThan(0);
      expect(ret).toBeGreaterThan(idx);
    });

    it('passes both p_match_id and p_org_id to the RPC', () => {
      expect(src).toMatch(/p_match_id:\s*matchId/);
      expect(src).toMatch(/p_org_id:\s*authCtx\.orgId/);
    });

    it('treats self-heal failure as non-fatal (logs but still returns 200)', () => {
      // A try/catch must wrap the rpc call so a self-heal failure can never
      // turn a successful idempotent return into a 5xx.
      expect(src).toMatch(/POI-012 engagement self-heal failed/);
      expect(src).toMatch(/POI-012 engagement self-heal threw/);
    });

    it('forwards engagement_created / engagement_existed flags in response', () => {
      expect(src).toMatch(/engagement_created:\s*engagementCreated/);
      expect(src).toMatch(/engagement_existed:\s*engagementExisted/);
    });

    it('does NOT call atomic_token_burn or atomic_generate_poi_v2 inside the fast-path block', () => {
      // Locate the fast-path block and assert no burn/mint helpers are invoked.
      const start = src.indexOf("Idempotent return if already past discovery");
      const end = src.indexOf("if (currentState !== 'discovery')");
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const block = src.slice(start, end);
      expect(block).not.toMatch(/atomic_token_burn/);
      expect(block).not.toMatch(/atomic_generate_poi_v2/);
    });
  });

  // ── DB helper contract ─────────────────────────────────────────────
  describe('ensure_poi_engagement_for_minted_match (DB helper)', () => {
    const sql = readSelfHealMigration();

    it('is SECURITY DEFINER with search_path locked to public', () => {
      expect(sql).toMatch(/SECURITY DEFINER/);
      expect(sql).toMatch(/SET search_path TO 'public'/);
    });

    it('takes a row lock on the matches row', () => {
      expect(sql).toMatch(/FROM matches[\s\S]*WHERE id = p_match_id[\s\S]*FOR UPDATE/);
    });

    it('rejects callers who are not a party to the match', () => {
      expect(sql).toMatch(/FORBIDDEN[\s\S]*Not a party to this deal/);
    });

    it('only acts on matches in a minted/past-discovery state', () => {
      expect(sql).toMatch(
        /v_match\.state IN \('intent_declared','counterparty_sighted','committed','completed'\)/,
      );
    });

    it('uses the partial unique index to dedupe (no double-current-engagement)', () => {
      expect(sql).toMatch(
        /engagement_status NOT IN \(\s*'expired'::engagement_status,\s*'declined'::engagement_status,\s*'cancelled_email_change'::engagement_status/,
      );
      expect(sql).toMatch(/EXCEPTION WHEN unique_violation THEN/);
    });

    it("tags repaired rows with source = 'poi_existing_repair'", () => {
      expect(sql).toMatch(/'poi_existing_repair'/);
    });

    it('NEVER touches token_ledger, ledger_events, or audit_logs', () => {
      // Strip the function body proper.
      expect(sql).not.toMatch(/INSERT INTO token_ledger/);
      expect(sql).not.toMatch(/INSERT INTO ledger_events/);
      expect(sql).not.toMatch(/INSERT INTO audit_logs/);
      expect(sql).not.toMatch(/atomic_token_burn/);
    });

    it('is locked to service_role per SECDEF Stage D1', () => {
      expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.ensure_poi_engagement_for_minted_match[\s\S]*FROM PUBLIC/);
      expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM anon/);
      expect(sql).toMatch(/REVOKE EXECUTE[\s\S]*FROM authenticated/);
      expect(sql).toMatch(/GRANT\s+EXECUTE[\s\S]*TO\s+service_role/);
    });
  });

  // ── Fix 2: reconciliation state-vs-ledger drift probe ──────────────
  describe('burn-poi-reconciliation: state-vs-ledger drift probe', () => {
    const src = readEdge('burn-poi-reconciliation');

    it('selects matches in a minted state and looks up their poi.minted ledger events', () => {
      expect(src).toMatch(/from\("matches"\)[\s\S]*\.in\("state",\s*\["intent_declared",\s*"counterparty_sighted",\s*"committed",\s*"completed"\]\)/);
      expect(src).toMatch(/from\("ledger_events"\)[\s\S]*\.eq\("event_type",\s*"poi\.minted"\)/);
    });

    it('classifies any minted match without a poi.minted ledger row as drift', () => {
      expect(src).toMatch(/stateWithoutLedger\.push/);
    });

    it('does NOT silently auto-repair the drifting row (read-only report)', () => {
      // The probe must not call atomic_generate_poi_v2 or insert into ledger_events.
      const start = src.indexOf("STATE_WITHOUT_LEDGER");
      const end = src.indexOf("Optional: open admin_risk_items");
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const block = src.slice(start, end);
      expect(block).not.toMatch(/atomic_generate_poi_v2/);
      expect(block).not.toMatch(/from\("ledger_events"\)\s*\.insert/);
      expect(block).not.toMatch(/from\("matches"\)\s*\.update/);
    });

    it('opens an admin_risk_item per drifting match (idempotent on title)', () => {
      expect(src).toMatch(/Reconciliation: minted state without ledger event \[match \$\{String\(drift\.match_id\)/);
    });

    it('exposes state_without_ledger in the JSON response and audit row', () => {
      expect(src).toMatch(/state_without_ledger:\s*\{\s*count:\s*stateWithoutLedger\.length/);
      expect(src).toMatch(/state_without_ledger:\s*stateWithoutLedger\.length/);
    });
  });

  // ── UI guard ───────────────────────────────────────────────────────
  describe('StateProgressionCard CTA gating', () => {
    const path = join(REPO, 'src', 'components', 'match', 'StateProgressionCard.tsx');

    it('component file exists', () => {
      expect(existsSync(path)).toBe(true);
    });

    it('does not render the Generate POI CTA outside the discovery state', () => {
      const src = readFileSync(path, 'utf8');
      // CTA gating: isPoiAction is derived from actionPath === "generate-poi",
      // which is itself derived from MatchState.getNextState(currentState).
      // Once the state leaves 'discovery', getNextState no longer points at the
      // POI generation transition, so the CTA cannot render.
      expect(src).toMatch(/isPoiAction\s*=\s*actionPath\s*===\s*["']generate-poi["']/);
      expect(src).toMatch(/MatchState\.getNextState\(currentState\)/);
    });
  });
});
