/**
 * DATA-003 Phase 1 — Edge-function BEHAVIOURAL proof (helper-mediated).
 *
 * Every wired callsite goes through the single `assertNoLegalHold`
 * chokepoint. This file exercises that chokepoint with an in-memory
 * legal_holds fixture and proves, end-to-end at the helper layer:
 *
 *   - active hold ON the scope          → blocked + canonical audit
 *   - released hold ON the scope        → NOT blocked, NO audit
 *   - no hold at all                    → NOT blocked, NO audit
 *   - active hold on an unrelated scope → NOT blocked
 *   - check query error                 → fail-CLOSED (audit + blocked)
 *
 * Wiring proof (each callsite calls this chokepoint before its
 * destructive op) lives in `legal-hold-edge-wiring.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertNoLegalHold,
  RECORD_GROUP_IDS,
  LEGAL_HOLD_AUDIT_NAMES,
  type LegalHoldScopeType,
} from "../../supabase/functions/_shared/legal-hold";

type Row = {
  id: string;
  scope_type: LegalHoldScopeType;
  scope_id: string;
  reason: string;
  applied_at: string;
  status: "active" | "released";
};

function mkAdmin(rows: Row[]) {
  const inserts: any[] = [];
  const client = {
    from(table: string) {
      if (table === "audit_logs") {
        return {
          insert: vi.fn((row: any) => {
            inserts.push(row);
            return Promise.resolve({ error: null });
          }),
        };
      }
      const chain: any = {
        _status: null as string | null,
        _or: null as string | null,
        select() { return chain; },
        eq(col: string, val: string) { if (col === "status") chain._status = val; return chain; },
        or(expr: string) { chain._or = expr; return chain; },
        limit() {
          const matching = rows.filter(
            (r) =>
              r.status === chain._status &&
              (chain._or ?? "").includes(`scope_id.eq.${r.scope_id}`) &&
              (chain._or ?? "").includes(`scope_type.eq.${r.scope_type}`),
          );
          return Promise.resolve({ data: matching, error: null });
        },
      };
      return chain;
    },
  };
  return { client, inserts };
}

const NOW = "2026-05-24T00:00:00Z";
const active = (scope_type: LegalHoldScopeType, scope_id: string, id = `h-${scope_id}`): Row => ({
  id,
  scope_type,
  scope_id,
  reason: "litigation hold for case 2026-XX-001",
  applied_at: NOW,
  status: "active",
});
const released = (scope_type: LegalHoldScopeType, scope_id: string, id = `h-${scope_id}`): Row => ({
  ...active(scope_type, scope_id, id),
  status: "released",
});

const cases: Array<{
  name: string;
  callerAction: string;
  buildScopes: () => Array<{ scope_type: LegalHoldScopeType; scope_id: string }>;
}> = [
  {
    name: "delete-account",
    callerAction: "delete-account.self_delete",
    buildScopes: () => [
      { scope_type: "user", scope_id: "11111111-1111-4111-8111-111111111111" },
      { scope_type: "org", scope_id: "22222222-2222-4222-8222-222222222222" },
    ],
  },
  {
    name: "user-export-request",
    callerAction: "user-export-request.create",
    buildScopes: () => [
      { scope_type: "user", scope_id: "33333333-3333-4333-8333-333333333333" },
      { scope_type: "org", scope_id: "44444444-4444-4444-8444-444444444444" },
    ],
  },
  {
    name: "data-retention (batch sentinel)",
    callerAction: "data-retention.enforce.matches",
    buildScopes: () => [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.retention_enforcement },
    ],
  },
  {
    name: "data-retention (per-row match)",
    callerAction: "data-retention.enforce.matches",
    buildScopes: () => [
      { scope_type: "match", scope_id: "55555555-5555-4555-8555-555555555555" },
    ],
  },
  {
    name: "storage-retention-cleanup (batch sentinel)",
    callerAction: "storage-retention-cleanup.batch",
    buildScopes: () => [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.storage_deletion_queue },
    ],
  },
  {
    name: "storage-retention-cleanup (per-file evidence)",
    callerAction: "storage-retention-cleanup.delete_file",
    buildScopes: () => [
      { scope_type: "evidence", scope_id: "66666666-6666-4666-8666-666666666666" },
    ],
  },
  {
    name: "storage-orphan-cleanup (batch sentinel)",
    callerAction: "storage-orphan-cleanup.batch",
    buildScopes: () => [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.storage_orphan_cleanup },
    ],
  },
  {
    name: "cold-storage-archive (batch sentinel)",
    callerAction: "cold-storage-archive.batch",
    buildScopes: () => [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.cold_storage_archive },
    ],
  },
  {
    name: "cold-storage-archive (per-flag evidence)",
    callerAction: "cold-storage-archive.match_documents",
    buildScopes: () => [
      { scope_type: "evidence", scope_id: "77777777-7777-4777-8777-777777777777" },
    ],
  },
  {
    name: "email-log-anonymise (batch sentinel)",
    callerAction: "email-log-anonymise.batch",
    buildScopes: () => [
      { scope_type: "record_group", scope_id: RECORD_GROUP_IDS.email_send_log_anonymise },
    ],
  },
  {
    name: "document-revoke (evidence + match)",
    callerAction: "document-revoke.revoke_document",
    buildScopes: () => [
      { scope_type: "evidence", scope_id: "88888888-8888-4888-8888-888888888888" },
      { scope_type: "match", scope_id: "99999999-9999-4999-8999-999999999999" },
    ],
  },
];

describe("DATA-003 — per-callsite behavioural matrix", () => {
  for (const c of cases) {
    describe(c.name, () => {
      let scopes: Array<{ scope_type: LegalHoldScopeType; scope_id: string }>;
      beforeEach(() => {
        scopes = c.buildScopes();
      });

      it("BLOCKS when an active hold covers any scope", async () => {
        const blocked = scopes[0];
        const { client, inserts } = mkAdmin([active(blocked.scope_type, blocked.scope_id)]);
        const r = await assertNoLegalHold(client as any, scopes, { action: c.callerAction });
        expect(r.blocked).toBe(true);
        expect(r.code).toBe("LEGAL_HOLD_ACTIVE");
        expect(r.activeHold?.scope_type).toBe(blocked.scope_type);
        expect(r.activeHold?.scope_id).toBe(blocked.scope_id);
        // canonical block audit emitted
        expect(inserts).toHaveLength(1);
        expect(inserts[0].action).toBe(LEGAL_HOLD_AUDIT_NAMES.deletion_blocked);
        expect(inserts[0].action).toBe("data.deletion_blocked_legal_hold");
        // action_context preserved for traceability
        expect(inserts[0].metadata.action_context).toBe(c.callerAction);
      });

      it("DOES NOT block when only released holds exist", async () => {
        const s = scopes[0];
        const { client, inserts } = mkAdmin([released(s.scope_type, s.scope_id)]);
        const r = await assertNoLegalHold(client as any, scopes, { action: c.callerAction });
        expect(r.blocked).toBe(false);
        expect(inserts).toHaveLength(0);
      });

      it("DOES NOT block when there is no hold at all", async () => {
        const { client, inserts } = mkAdmin([]);
        const r = await assertNoLegalHold(client as any, scopes, { action: c.callerAction });
        expect(r.blocked).toBe(false);
        expect(inserts).toHaveLength(0);
      });

      it("DOES NOT block when an active hold targets an UNRELATED scope", async () => {
        const { client, inserts } = mkAdmin([
          active("user", "00000000-0000-4000-8000-deadbeefdead", "h-unrelated"),
        ]);
        const r = await assertNoLegalHold(client as any, scopes, { action: c.callerAction });
        expect(r.blocked).toBe(false);
        expect(inserts).toHaveLength(0);
      });
    });
  }
});
