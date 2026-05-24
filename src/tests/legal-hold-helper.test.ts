/**
 * DATA-003 Phase 1 — shared helper unit tests.
 *
 * Verifies the `assertNoLegalHold` contract with an in-memory stub of the
 * supabase service-role client:
 *   - empty scopes → no block
 *   - active hold present → blocked, code=LEGAL_HOLD_ACTIVE, audit emitted
 *   - released hold only → not blocked
 *   - query error → fail-CLOSED with code=LEGAL_HOLD_CHECK_FAILED
 *   - multiple scopes → blocked when any one matches
 */
import { describe, it, expect, vi } from "vitest";
import {
  assertNoLegalHold,
  LEGAL_HOLD_AUDIT_NAMES,
  RECORD_GROUP_IDS,
} from "../../supabase/functions/_shared/legal-hold";

type Row = {
  id: string;
  scope_type: string;
  scope_id: string;
  reason: string;
  applied_at: string;
  status: "active" | "released";
};

function makeAdmin(rows: Row[], opts: { failQuery?: boolean } = {}) {
  const auditInserts: any[] = [];
  const client = {
    from(table: string) {
      if (table === "audit_logs") {
        return { insert: vi.fn((row: any) => { auditInserts.push(row); return Promise.resolve({ error: null }); }) };
      }
      // legal_holds chain
      const chain: any = {
        _filters: { status: null as string | null, or: null as string | null },
        select() { return chain; },
        eq(col: string, val: string) { if (col === "status") chain._filters.status = val; return chain; },
        or(expr: string) { chain._filters.or = expr; return chain; },
        limit() {
          if (opts.failQuery) return Promise.resolve({ data: null, error: { message: "boom" } });
          const matching = rows.filter(r =>
            r.status === chain._filters.status &&
            (chain._filters.or ?? "").includes(`scope_id.eq.${r.scope_id}`)
          );
          return Promise.resolve({ data: matching, error: null });
        },
      };
      return chain;
    },
  };
  return { client, auditInserts };
}

describe("assertNoLegalHold", () => {
  it("returns blocked=false when no scopes supplied", async () => {
    const { client } = makeAdmin([]);
    const res = await assertNoLegalHold(client as any, [], { action: "test.noop" });
    expect(res.blocked).toBe(false);
  });

  it("returns blocked=false when no active hold matches", async () => {
    const { client, auditInserts } = makeAdmin([]);
    const res = await assertNoLegalHold(client as any, [
      { scope_type: "user", scope_id: "u-1" },
    ], { action: "test.ok" });
    expect(res.blocked).toBe(false);
    expect(auditInserts).toHaveLength(0);
  });

  it("blocks when an active hold covers a scope and emits canonical audit", async () => {
    const { client, auditInserts } = makeAdmin([
      { id: "h-1", scope_type: "user", scope_id: "u-1", reason: "litigation", applied_at: new Date().toISOString(), status: "active" },
    ]);
    const res = await assertNoLegalHold(client as any, [
      { scope_type: "user", scope_id: "u-1" },
    ], { action: "delete-account.self_delete", actorUserId: "u-1" });
    expect(res.blocked).toBe(true);
    expect(res.code).toBe("LEGAL_HOLD_ACTIVE");
    expect(res.activeHold?.id).toBe("h-1");
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].action).toBe(LEGAL_HOLD_AUDIT_NAMES.deletion_blocked);
    expect(auditInserts[0].action).toBe("data.deletion_blocked_legal_hold");
  });

  it("does not block when only released holds exist", async () => {
    const { client } = makeAdmin([
      { id: "h-2", scope_type: "user", scope_id: "u-2", reason: "old", applied_at: new Date().toISOString(), status: "released" },
    ]);
    const res = await assertNoLegalHold(client as any, [
      { scope_type: "user", scope_id: "u-2" },
    ], { action: "test.released" });
    expect(res.blocked).toBe(false);
  });

  it("blocks when any of multiple scopes is held", async () => {
    const { client } = makeAdmin([
      { id: "h-3", scope_type: "org", scope_id: "o-3", reason: "investigation", applied_at: new Date().toISOString(), status: "active" },
    ]);
    const res = await assertNoLegalHold(client as any, [
      { scope_type: "user", scope_id: "u-x" },
      { scope_type: "org", scope_id: "o-3" },
    ], { action: "test.multi" });
    expect(res.blocked).toBe(true);
    expect(res.activeHold?.scope_type).toBe("org");
  });

  it("fails CLOSED when the query errors", async () => {
    const { client, auditInserts } = makeAdmin([], { failQuery: true });
    const res = await assertNoLegalHold(client as any, [
      { scope_type: "user", scope_id: "u-fail" },
    ], { action: "test.fail_closed" });
    expect(res.blocked).toBe(true);
    expect(res.code).toBe("LEGAL_HOLD_CHECK_FAILED");
    // Best-effort audit of the failure
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0].action).toBe("data.deletion_blocked_legal_hold");
  });

  it("exposes well-known record_group sentinels", () => {
    expect(RECORD_GROUP_IDS.retention_enforcement).toMatch(/^[0-9a-f-]{36}$/);
    expect(RECORD_GROUP_IDS.email_send_log_anonymise).toMatch(/^[0-9a-f-]{36}$/);
    expect(RECORD_GROUP_IDS.storage_deletion_queue).not.toBe(RECORD_GROUP_IDS.storage_orphan_cleanup);
  });

  it("canonical audit-name constants are stable", () => {
    expect(LEGAL_HOLD_AUDIT_NAMES.applied).toBe("data.legal_hold_applied");
    expect(LEGAL_HOLD_AUDIT_NAMES.released).toBe("data.legal_hold_released");
    expect(LEGAL_HOLD_AUDIT_NAMES.deletion_blocked).toBe("data.deletion_blocked_legal_hold");
  });
});
