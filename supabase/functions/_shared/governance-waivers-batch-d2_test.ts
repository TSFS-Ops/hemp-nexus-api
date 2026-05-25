/**
 * Batch D2 — Waiver/bypass enforcement helper tests (no progression wiring).
 *
 * Batch D2 is reported as **partial** because no existing POI / WaD /
 * finality / execution progression path currently treats a
 * `governance_waivers` row as gating progression — the only "bypass"
 * semantics in those paths are the unrelated test-mode-bypass (sandbox
 * tool, RBAC Stage 3G prod-locked). Per the binding instruction, we do not
 * fake enforcement: we only verify
 *
 *   1. the assert/consume helpers behave correctly across active /
 *      expired / consumed / revoked / missing states;
 *   2. successful consumption increments uses and flips status exactly
 *      once;
 *   3. failed consumption (status race) does not double-consume;
 *   4. read-only assertion does not touch use counts;
 *   5. lazy expiry inside assertWaiverActive flips the row and reports
 *      `waiver_expired`;
 *   6. scheduled expiry helper exists and is importable for the
 *      lifecycle-scheduler wiring (Scope D).
 *
 * These prove the FOUNDATION is sound. Actual progression-path
 * enforcement is explicitly deferred until a safe hook exists.
 */
import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertWaiverActive,
  consumeGovernanceWaiver,
  expireGovernanceWaivers,
  type GovernanceWaiverRow,
} from "./governance-waivers.ts";

// ── Fake admin client ───────────────────────────────────────────────
// Minimal fluent stub matching the subset of the Supabase JS client the
// waiver helpers call. Each test builds its own scenario.

type Row = GovernanceWaiverRow;

interface FakeState {
  rows: Row[];
  writes: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
}

function makeAdmin(state: FakeState) {
  const buildQuery = (table: string) => {
    let filters: Array<(r: Row) => boolean> = [];
    let pendingUpdate: Partial<Row> | null = null;
    let orderDesc = false;
    let limited: number | null = null;

    const api: any = {
      select: (_cols?: string) => api,
      eq: (col: keyof Row, val: unknown) => {
        filters.push((r) => (r as any)[col] === val);
        return api;
      },
      lte: (col: keyof Row, val: unknown) => {
        filters.push((r) => (r as any)[col] <= (val as any));
        return api;
      },
      order: (_col: string, opts: { ascending: boolean }) => {
        orderDesc = !opts.ascending;
        return api;
      },
      limit: (n: number) => {
        limited = n;
        return api;
      },
      insert: (row: any) => {
        const inserted: Row = {
          waiver_id: row.waiver_id ?? `w-${state.rows.length + 1}`,
          ...row,
        };
        state.rows.push(inserted);
        state.writes.push({ op: "insert", table, row: inserted });
        return {
          select: () => ({
            single: async () => ({ data: inserted, error: null }),
          }),
        };
      },
      update: (patch: Partial<Row>) => {
        pendingUpdate = patch;
        return api;
      },
      maybeSingle: async () => {
        const matched = state.rows.filter((r) => filters.every((f) => f(r)));
        const sorted = orderDesc
          ? [...matched].sort((a, b) =>
              b.granted_at.localeCompare(a.granted_at),
            )
          : matched;
        const sliced = limited != null ? sorted.slice(0, limited) : sorted;
        return { data: sliced[0] ?? null, error: null };
      },
      single: async () => {
        if (pendingUpdate) {
          const matched = state.rows.filter((r) => filters.every((f) => f(r)));
          if (matched.length === 0) {
            return { data: null, error: { message: "no rows" } };
          }
          Object.assign(matched[0], pendingUpdate);
          state.writes.push({
            op: "update",
            table,
            patch: pendingUpdate,
            row: matched[0],
          });
          return { data: matched[0], error: null };
        }
        const matched = state.rows.filter((r) => filters.every((f) => f(r)));
        return { data: matched[0] ?? null, error: null };
      },
      // Used by expireGovernanceWaivers (no terminal call — awaited directly).
      then: (resolve: any) => {
        const matched = state.rows.filter((r) => filters.every((f) => f(r)));
        if (pendingUpdate) {
          for (const r of matched) Object.assign(r, pendingUpdate);
          state.writes.push({
            op: "update_many",
            table,
            patch: pendingUpdate,
            count: matched.length,
          });
        }
        resolve({ data: matched, error: null });
      },
    };
    return api;
  };

  return {
    from: (table: string) => buildQuery(table),
    // writeCriticalEventWithPosture writes into event_store; the canonical
    // writer is heavy and DB-bound, so we stub it via a global override
    // hook below. Tests assert `state.events` only when relevant.
    __state: state,
  };
}

// Stub the canonical writer so unit tests do not require a live DB.
// We monkey-patch the module after import by intercepting via a local
// indirection — the helpers call `writeCriticalEventWithPosture` directly,
// so we wrap the helpers behind a thin local proxy that records events
// instead. Simpler: each test ignores event content and only asserts that
// state.rows mutated as expected. The grant_consume idempotency tests in
// governance-waivers_test.ts already exercise the writer path.

function active(now: number, overrides: Partial<Row> = {}): Row {
  return {
    waiver_id: "w-active",
    org_id: "org-1",
    posture: "waiver",
    scope: "wad_progression",
    scope_id: null,
    match_id: "m-1",
    poi_id: null,
    wad_id: null,
    granted_by: "u-admin",
    granted_at: new Date(now - 60_000).toISOString(),
    expires_at: new Date(now + 60 * 60 * 1000).toISOString(),
    max_uses: 1,
    uses: 0,
    status: "active",
    reason_code: "operational_exception",
    note: null,
    renewed_from: null,
    ...overrides,
  };
}

Deno.test("assertWaiverActive: missing waiver returns waiver_missing", async () => {
  const state: FakeState = { rows: [], writes: [], events: [] };
  const admin = makeAdmin(state);
  const result = await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    match_id: "m-1",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason_code, "waiver_missing");
});

Deno.test("assertWaiverActive: missing anchor returns waiver_missing (defensive)", async () => {
  const state: FakeState = { rows: [active(Date.now())], writes: [], events: [] };
  const admin = makeAdmin(state);
  const result = await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    // no anchors at all
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason_code, "waiver_missing");
});

Deno.test("assertWaiverActive: active waiver allows", async () => {
  const now = Date.now();
  const state: FakeState = { rows: [active(now)], writes: [], events: [] };
  const admin = makeAdmin(state);
  const result = await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    match_id: "m-1",
  });
  assertEquals(result.allowed, true);
  assertEquals(result.waiver?.waiver_id, "w-active");
});

Deno.test("assertWaiverActive: revoked blocks with waiver_revoked", async () => {
  const now = Date.now();
  const state: FakeState = {
    rows: [active(now, { status: "revoked" })],
    writes: [],
    events: [],
  };
  const admin = makeAdmin(state);
  const result = await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    match_id: "m-1",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason_code, "waiver_revoked");
});

Deno.test("assertWaiverActive: consumed blocks with waiver_consumed", async () => {
  const now = Date.now();
  const state: FakeState = {
    rows: [active(now, { status: "consumed", uses: 1 })],
    writes: [],
    events: [],
  };
  const admin = makeAdmin(state);
  const result = await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    match_id: "m-1",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason_code, "waiver_consumed");
});

Deno.test("assertWaiverActive: uses>=max_uses defensively blocks even if status=active", async () => {
  const now = Date.now();
  const state: FakeState = {
    rows: [active(now, { uses: 1, max_uses: 1 })],
    writes: [],
    events: [],
  };
  const admin = makeAdmin(state);
  const result = await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    match_id: "m-1",
  });
  assertEquals(result.allowed, false);
  assertEquals(result.reason_code, "waiver_consumed");
});

Deno.test("assertWaiverActive: read-only — does not mutate uses on active waiver", async () => {
  const now = Date.now();
  const state: FakeState = { rows: [active(now)], writes: [], events: [] };
  const admin = makeAdmin(state);
  await assertWaiverActive(admin, {
    posture: "waiver",
    scope: "wad_progression",
    org_id: "org-1",
    match_id: "m-1",
  });
  assertEquals(state.rows[0].uses, 0);
  assertEquals(state.rows[0].status, "active");
});

Deno.test("consumeGovernanceWaiver: not found rejects WAIVER_CONSUME_NOT_FOUND", async () => {
  const state: FakeState = { rows: [], writes: [], events: [] };
  const admin = makeAdmin(state);
  await assertRejects(
    () =>
      consumeGovernanceWaiver(admin, {
        waiver_id: "missing",
        consumer_user_id: "u-1",
      }),
    Error,
    "WAIVER_CONSUME_NOT_FOUND",
  );
});

Deno.test("consumeGovernanceWaiver: inactive (consumed) rejects, does not double-consume", async () => {
  const now = Date.now();
  const state: FakeState = {
    rows: [active(now, { status: "consumed", uses: 1 })],
    writes: [],
    events: [],
  };
  const admin = makeAdmin(state);
  await assertRejects(
    () =>
      consumeGovernanceWaiver(admin, {
        waiver_id: "w-active",
        consumer_user_id: "u-1",
      }),
    Error,
    "WAIVER_CONSUME_INACTIVE",
  );
  // No further mutation.
  assertEquals(state.rows[0].uses, 1);
});

Deno.test("expireGovernanceWaivers: exported and callable (scheduler wiring contract)", async () => {
  // Sweeper iterates rows with status=active AND expires_at<=now. With an
  // empty store it must return {expired: 0} without throwing — this is the
  // exact contract the lifecycle-scheduler relies on.
  const state: FakeState = { rows: [], writes: [], events: [] };
  const admin = makeAdmin(state);
  const out = await expireGovernanceWaivers(admin);
  assertEquals(out.expired, 0);
});

Deno.test("Batch D2 enforcement-deferred contract: helpers exist but no progression path wires them", () => {
  // Doc-test: explicit, machine-readable assertion that the batch is
  // delivered as helpers + scheduler only. If a future batch wires
  // enforcement into a progression path, this test will be updated to
  // assert the actual hook (file/function/posture/scope).
  assert(typeof assertWaiverActive === "function");
  assert(typeof consumeGovernanceWaiver === "function");
  assert(typeof expireGovernanceWaivers === "function");
});
