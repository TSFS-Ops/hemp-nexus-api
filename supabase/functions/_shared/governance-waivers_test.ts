/**
 * Batch D — governance-waivers helper tests (pure logic + fake admin client).
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertWaiverActive,
  clampExpiry,
  consumeGovernanceWaiver,
  grantGovernanceWaiver,
  renewGovernanceWaiver,
  WAIVER_MAX_DAYS,
  WAIVER_MAX_MS,
} from "./governance-waivers.ts";

// ── Pure-logic test for clampExpiry ─────────────────────────────────────────
Deno.test("clampExpiry: defaults to now+7 days when missing", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const out = clampExpiry(null, now);
  assertEquals(out, new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("clampExpiry: caps proposals beyond 7 days", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const tenDays = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
  const out = clampExpiry(tenDays, now);
  assertEquals(out, new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("clampExpiry: honours shorter proposals", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const oneHour = new Date(now + 60 * 60 * 1000).toISOString();
  assertEquals(clampExpiry(oneHour, now), oneHour);
});

Deno.test("clampExpiry: past dates collapse to default cap", () => {
  const now = Date.parse("2026-05-25T00:00:00Z");
  const past = new Date(now - 1000).toISOString();
  assertEquals(clampExpiry(past, now), new Date(now + WAIVER_MAX_MS).toISOString());
});

Deno.test("WAIVER_MAX_DAYS is 7", () => assertEquals(WAIVER_MAX_DAYS, 7));

// ── Fake admin client to exercise grant/assert/consume flows ───────────────
function makeFakeAdmin() {
  // deno-lint-ignore no-explicit-any
  const rows: any[] = [];
  // deno-lint-ignore no-explicit-any
  const events: any[] = [];

  // deno-lint-ignore no-explicit-any
  const builder = (rowsRef: any[]) => {
    // deno-lint-ignore no-explicit-any
    let filtered: any[] = rowsRef.slice();
    // deno-lint-ignore no-explicit-any
    let updatePatch: any = null;
    // deno-lint-ignore no-explicit-any
    const obj: any = {
      select: (_cols?: string) => obj,
      insert: (row: Record<string, unknown>) => {
        const insertedRow = {
          waiver_id: crypto.randomUUID(),
          status: "active",
          uses: 0,
          max_uses: 1,
          granted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...row,
        };
        rowsRef.push(insertedRow);
        filtered = [insertedRow];
        return obj;
      },
      update: (patch: Record<string, unknown>) => {
        updatePatch = patch;
        return obj;
      },
      eq: (col: string, val: unknown) => {
        filtered = filtered.filter((r) => r[col] === val);
        return obj;
      },
      lte: (col: string, val: string) => {
        filtered = filtered.filter((r) => r[col] <= val);
        return obj;
      },
      order: () => obj,
      limit: () => obj,
      maybeSingle: () => {
        if (updatePatch) {
          for (const r of filtered) Object.assign(r, updatePatch);
        }
        return Promise.resolve({ data: filtered[0] ?? null, error: null });
      },
      single: () => {
        if (updatePatch) for (const r of filtered) Object.assign(r, updatePatch);
        return Promise.resolve({ data: filtered[0], error: null });
      },
      then: (resolve: (v: { data: unknown; error: null }) => void) => {
        if (updatePatch) for (const r of filtered) Object.assign(r, updatePatch);
        resolve({ data: filtered, error: null });
      },
    };
    return obj;
  };

  return {
    rows,
    events,
    from: (table: string) => {
      if (table === "governance_waivers") return builder(rows);
      if (table === "event_store") {
        return {
          insert: (row: Record<string, unknown>) => {
            events.push(row);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({
                    data: { id: crypto.randomUUID(), ...row },
                    error: null,
                  }),
              }),
            };
          },
          select: () => ({
            eq: () => ({ gte: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          }),
        };
      }
      return builder([]);
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

const ORG = "00000000-0000-0000-0000-000000000001";
const MATCH = "00000000-0000-0000-0000-000000000002";
const ACTOR = "00000000-0000-0000-0000-000000000003";

Deno.test("grant: defaults to 1 use and 7-day expiry; emits granted event", async () => {
  const a = makeFakeAdmin();
  // deno-lint-ignore no-explicit-any
  const row = await grantGovernanceWaiver(a as any, {
    org_id: ORG,
    posture: "waiver",
    scope: "poi",
    match_id: MATCH,
    granted_by: ACTOR,
    reason_code: "client_instruction",
  });
  assertEquals(row.max_uses, 1);
  assertEquals(row.uses, 0);
  assertEquals(row.status, "active");
  const expSpread = Date.parse(row.expires_at) - Date.parse(row.granted_at);
  assert(expSpread > 0 && expSpread <= WAIVER_MAX_MS + 1000);
  const granted = a.events.find((e) => e.event_type === "governance.waiver_granted");
  assert(granted, "expected granted event");
});

Deno.test("assertWaiverActive: returns allowed for fresh active waiver", async () => {
  const a = makeFakeAdmin();
  // deno-lint-ignore no-explicit-any
  await grantGovernanceWaiver(a as any, {
    org_id: ORG,
    posture: "waiver",
    scope: "poi",
    match_id: MATCH,
    granted_by: ACTOR,
    reason_code: "client_instruction",
  });
  // deno-lint-ignore no-explicit-any
  const r = await assertWaiverActive(a as any, {
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
  });
  assertEquals(r.allowed, true);
  assert(r.waiver);
});

Deno.test("assertWaiverActive: missing waiver returns waiver_missing", async () => {
  const a = makeFakeAdmin();
  // deno-lint-ignore no-explicit-any
  const r = await assertWaiverActive(a as any, {
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
  });
  assertEquals(r.allowed, false);
  assertEquals(r.reason_code, "waiver_missing");
});

Deno.test("assertWaiverActive: expired (by time) returns waiver_expired and emits expired event", async () => {
  const a = makeFakeAdmin();
  // deno-lint-ignore no-explicit-any
  const row = await grantGovernanceWaiver(a as any, {
    org_id: ORG,
    posture: "waiver",
    scope: "poi",
    match_id: MATCH,
    granted_by: ACTOR,
    reason_code: "client_instruction",
  });
  // backdate expiry
  row.expires_at = new Date(Date.now() - 1000).toISOString();
  // deno-lint-ignore no-explicit-any
  const r = await assertWaiverActive(a as any, {
    posture: "waiver",
    scope: "poi",
    org_id: ORG,
    match_id: MATCH,
  });
  assertEquals(r.allowed, false);
  assertEquals(r.reason_code, "waiver_expired");
  const expiredEv = a.events.find((e) => e.event_type === "governance.waiver_expired");
  assert(expiredEv, "expected waiver_expired event");
});

Deno.test("consume: increments uses and flips to consumed; emits consumed event", async () => {
  const a = makeFakeAdmin();
  // deno-lint-ignore no-explicit-any
  const row = await grantGovernanceWaiver(a as any, {
    org_id: ORG,
    posture: "bypass",
    scope: "execution",
    match_id: MATCH,
    granted_by: ACTOR,
    reason_code: "system_recovery",
  });
  // deno-lint-ignore no-explicit-any
  const after = await consumeGovernanceWaiver(a as any, {
    waiver_id: row.waiver_id,
    consumer_user_id: ACTOR,
  });
  assertEquals(after.uses, 1);
  assertEquals(after.status, "consumed");
  // deno-lint-ignore no-explicit-any
  const r = await assertWaiverActive(a as any, {
    posture: "bypass",
    scope: "execution",
    org_id: ORG,
    match_id: MATCH,
  });
  assertEquals(r.allowed, false);
  assertEquals(r.reason_code, "waiver_consumed");
  const ev = a.events.find((e) => e.event_type === "governance.bypass_consumed");
  assert(ev, "expected bypass_consumed event");
});

Deno.test("renew: creates a new row referencing renewed_from; emits renewed event", async () => {
  const a = makeFakeAdmin();
  // deno-lint-ignore no-explicit-any
  const prior = await grantGovernanceWaiver(a as any, {
    org_id: ORG,
    posture: "waiver",
    scope: "poi",
    match_id: MATCH,
    granted_by: ACTOR,
    reason_code: "client_instruction",
  });
  // deno-lint-ignore no-explicit-any
  const renewed = await renewGovernanceWaiver(a as any, {
    prior_waiver_id: prior.waiver_id,
    granted_by: ACTOR,
    reason_code: "waiver_renewed",
  });
  assertEquals(renewed.renewed_from, prior.waiver_id);
  assertEquals(renewed.status, "active");
  const ev = a.events.find((e) => e.event_type === "governance.waiver_renewed");
  assert(ev, "expected waiver_renewed event");
});
