// Ticket 3 — POI Gate Edge-Runtime Integration Tests.
//
// Exercises the REAL gate code paths (`_shared/legitimacy.ts` +
// `_shared/poi-authority.ts`) against a realistic `trade_approvals`
// fixture matrix, using a mock supabase admin client that returns the
// shape the actual code queries.
//
// Discipline:
//   - We DO NOT modify gate logic.
//   - We DO NOT invent new statuses or audit actions.
//   - We assert allow/block outcomes, denial reasons, and the canonical
//     metadata fields that Ticket 2's HQ audit panel surfaces
//     (reason_code, authority_reason, gate_position, …).
//
// Run: deno test supabase/functions/_shared/poi-gate-integration_test.ts

import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkOrgLegitimacy,
  getActiveGovernanceProfile,
  ORG_NOT_VERIFIED_CODE,
  type GatePosition,
} from "./legitimacy.ts";
import {
  checkUserPoiAuthority,
  authorityAuditMetadata,
  USER_NOT_AUTHORISED_CODE,
} from "./poi-authority.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture types — mirrors only the columns the gate actually reads.
// ─────────────────────────────────────────────────────────────────────────────

interface Fixture {
  gatePosition?: GatePosition;
  org?: { id: string; frozen?: boolean; frozen_reason?: string | null } | null;
  // Most-recent trade_approvals row for the org (or null if none).
  tradeApproval?:
    | { id: string; org_id: string; status: string; valid_until: string | null }
    | null
    | "ERROR";
  // user_id → org_id mapping (profiles table).
  profiles?: Record<string, { org_id: string | null }>;
  // user_id → role[] mapping (user_roles table).
  roles?: Record<string, string[]>;
  // Active org_governance_profiles row, if any.
  governanceProfile?:
    | { id: string; verification_gate_position: GatePosition }
    | null;
}

// Minimal fake admin client that responds to the exact query shapes the
// real gate functions call. Anything outside that shape is intentionally
// not implemented — keeps the harness honest.
// deno-lint-ignore no-explicit-any
function makeAdmin(fx: Fixture): any {
  const queryBuilder = (table: string) => {
    const state: {
      table: string;
      filters: { col: string; val: unknown }[];
      isNull: string | null;
    } = { table, filters: [], isNull: null };
    const api: any = {
      select: (_cols: string) => api,
      eq: (col: string, val: unknown) => {
        state.filters.push({ col, val });
        return api;
      },
      is: (col: string, _val: unknown) => {
        state.isNull = col;
        return api;
      },
      order: (_col: string, _opts?: unknown) => api,
      limit: (_n: number) => api,
      insert: async (_row: unknown) => ({ data: null, error: null }),
      maybeSingle: async () => resolve(state, false),
      // user_roles is read without maybeSingle — it returns an array.
      then: undefined,
    };
    // For user_roles we await the builder directly: support thenable.
    api[Symbol.asyncIterator] = undefined;
    (api as any).__await = async () => resolve(state, true);
    return api;
  };

  const resolve = async (
    state: { table: string; filters: { col: string; val: unknown }[]; isNull: string | null },
    asList: boolean,
  ) => {
    switch (state.table) {
      case "organizations": {
        const want = state.filters.find((f) => f.col === "id")?.val;
        if (!fx.org || fx.org.id !== want) return { data: null, error: null };
        return {
          data: { frozen: !!fx.org.frozen, frozen_reason: fx.org.frozen_reason ?? null },
          error: null,
        };
      }
      case "trade_approvals": {
        if (fx.tradeApproval === "ERROR") {
          return { data: null, error: { message: "lookup failed" } };
        }
        return { data: fx.tradeApproval ?? null, error: null };
      }
      case "profiles": {
        const want = String(state.filters.find((f) => f.col === "id")?.val ?? "");
        const row = fx.profiles?.[want] ?? null;
        return { data: row, error: null };
      }
      case "org_governance_profiles": {
        return { data: fx.governanceProfile ?? null, error: null };
      }
      case "user_roles": {
        const want = String(state.filters.find((f) => f.col === "user_id")?.val ?? "");
        const rs = fx.roles?.[want] ?? [];
        return { data: rs.map((r) => ({ role: r })), error: null };
      }
      default:
        return asList ? { data: [], error: null } : { data: null, error: null };
    }
  };

  return {
    from: (table: string) => {
      const qb = queryBuilder(table);
      // user_roles path: real code does `await admin.from(...).select(...).eq(...)`
      // i.e. awaits the builder. Make the builder thenable.
      const handler = {
        get(target: any, prop: string) {
          if (prop === "then") {
            return (resolveFn: any, rejectFn: any) => {
              target.__await().then(resolveFn, rejectFn);
            };
          }
          return target[prop];
        },
      };
      return new Proxy(qb, handler);
    },
    rpc: async (name: string, _params: unknown) => {
      if (name === "get_org_gate_position") {
        return { data: fx.gatePosition ?? "poi_mint", error: null };
      }
      return { data: null, error: null };
    },
  };
}

const ORG_A = "00000000-0000-0000-0000-00000000000a";
const ORG_B = "00000000-0000-0000-0000-00000000000b";
const USER_DIRECTOR = "00000000-0000-0000-0000-0000000000d1";
const USER_MEMBER = "00000000-0000-0000-0000-0000000000d2";
const USER_AUDITOR = "00000000-0000-0000-0000-0000000000d3";
const USER_CROSS_ORG = "00000000-0000-0000-0000-0000000000d4";

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
// Allow path — approved + authorised user.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("allows POI mint when trade approval is approved and actor has authority", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A, frozen: false },
    tradeApproval: { id: "ta-1", org_id: ORG_A, status: "approved", valid_until: FUTURE },
    profiles: { [USER_DIRECTOR]: { org_id: ORG_A } },
    roles: { [USER_DIRECTOR]: ["org_member", "director"] },
  });
  const legit = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(legit.allowed);
  assertEquals(legit.status, "approved");
  const auth = await checkUserPoiAuthority(admin, USER_DIRECTOR, ORG_A);
  assert(auth.allowed);
});

// ─────────────────────────────────────────────────────────────────────────────
// Block matrix — legitimacy gate.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("blocks POI mint when no trade_approvals row exists for the org", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A, frozen: false },
    tradeApproval: null,
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assertFalse(decision.allowed);
  assert(!decision.allowed);
  assertEquals(decision.reason, "no_record");
  assertEquals(decision.gatePosition, "poi_mint");
});

Deno.test("blocks POI mint when trade approval is pending (not 'approved')", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: { id: "ta-2", org_id: ORG_A, status: "pending", valid_until: null },
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(!decision.allowed);
  assertEquals(decision.reason, "not_approved");
  assertEquals(decision.status, "pending");
});

Deno.test("blocks POI mint when trade approval is revoked (canonical revoked reason)", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: { id: "ta-3", org_id: ORG_A, status: "revoked", valid_until: null },
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(!decision.allowed);
  assertEquals(decision.reason, "revoked");
});

Deno.test("blocks POI mint when trade approval has expired", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: { id: "ta-4", org_id: ORG_A, status: "approved", valid_until: PAST },
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(!decision.allowed);
  assertEquals(decision.reason, "expired");
});

Deno.test("blocks POI mint when organisation is frozen (blocked/suspended)", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A, frozen: true, frozen_reason: "compliance_review" },
    tradeApproval: { id: "ta-5", org_id: ORG_A, status: "approved", valid_until: FUTURE },
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(!decision.allowed);
  assertEquals(decision.reason, "frozen");
  // The frozen reason must reach the operator-facing message, so HQ sees it.
  assert(decision.message.includes("compliance_review"));
});

Deno.test("fails CLOSED (not open) when the legitimacy lookup itself errors", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: "ERROR",
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(!decision.allowed);
  assertEquals(decision.reason, "lookup_failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate-position variant — wad_only defers verification.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("wad_only gate position allows POI mint even without trade approval (deferred to WaD)", async () => {
  const admin = makeAdmin({
    gatePosition: "wad_only",
    org: { id: ORG_A },
    tradeApproval: null,
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(decision.allowed);
  assertEquals(decision.status, "deferred");
  assertEquals(decision.gatePosition, "wad_only");
});

// ─────────────────────────────────────────────────────────────────────────────
// Authority gate — user side of the rule.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("blocks POI mint when actor belongs to a DIFFERENT organisation (tenant boundary)", async () => {
  const admin = makeAdmin({
    profiles: { [USER_CROSS_ORG]: { org_id: ORG_B } },
    roles: { [USER_CROSS_ORG]: ["director"] },
  });
  const auth = await checkUserPoiAuthority(admin, USER_CROSS_ORG, ORG_A);
  assert(!auth.allowed);
  assertEquals(auth.reason, "user_not_in_org");
});

Deno.test("blocks POI mint when actor only holds plain org_member (no issuer role)", async () => {
  const admin = makeAdmin({
    profiles: { [USER_MEMBER]: { org_id: ORG_A } },
    roles: { [USER_MEMBER]: ["org_member"] },
  });
  const auth = await checkUserPoiAuthority(admin, USER_MEMBER, ORG_A);
  assert(!auth.allowed);
  assertEquals(auth.reason, "no_issuer_role");
  // The held_roles array must travel into the canonical audit metadata so
  // Ticket 2 HQ visibility can surface it.
  const meta = authorityAuditMetadata(auth, { endpoint: "pois" });
  assertEquals(meta.reason_code, USER_NOT_AUTHORISED_CODE);
  assertEquals(meta.authority_reason, "no_issuer_role");
  assertEquals(meta.held_roles, ["org_member"]);
  assertEquals((meta as Record<string, unknown>).endpoint, "pois");
});

Deno.test("blocks POI mint when actor is read-only auditor (auditor alone is not an issuer role)", async () => {
  const admin = makeAdmin({
    profiles: { [USER_AUDITOR]: { org_id: ORG_A } },
    roles: { [USER_AUDITOR]: ["auditor"] },
  });
  const auth = await checkUserPoiAuthority(admin, USER_AUDITOR, ORG_A);
  assert(!auth.allowed);
  assertEquals(auth.reason, "no_issuer_role");
});

Deno.test("allows authority check for each canonical issuer role", async () => {
  for (const role of ["platform_admin", "org_admin", "director", "broker", "seller", "buyer"]) {
    const uid = `00000000-0000-0000-0000-0000000000${role.length.toString().padStart(2, "0")}`;
    const admin = makeAdmin({
      profiles: { [uid]: { org_id: ORG_A } },
      roles: { [uid]: ["org_member", role] },
    });
    const auth = await checkUserPoiAuthority(admin, uid, ORG_A);
    assert(auth.allowed, `expected ${role} to be allowed`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Combined matrix — both gates must clear (negative-path safety).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("authorised user CANNOT bypass a blocked trade approval", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: { id: "ta-9", org_id: ORG_A, status: "revoked", valid_until: null },
    profiles: { [USER_DIRECTOR]: { org_id: ORG_A } },
    roles: { [USER_DIRECTOR]: ["director"] },
  });
  const auth = await checkUserPoiAuthority(admin, USER_DIRECTOR, ORG_A);
  const legit = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(auth.allowed);
  assertFalse(legit.allowed);
  // Composite contract enforced by edge functions — neither side alone wins.
  const compositeAllowed = auth.allowed && legit.allowed;
  assertFalse(compositeAllowed);
});

Deno.test("valid trade approval CANNOT bypass missing user authority", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: { id: "ta-10", org_id: ORG_A, status: "approved", valid_until: FUTURE },
    profiles: { [USER_MEMBER]: { org_id: ORG_A } },
    roles: { [USER_MEMBER]: ["org_member"] },
  });
  const auth = await checkUserPoiAuthority(admin, USER_MEMBER, ORG_A);
  const legit = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(legit.allowed);
  assertFalse(auth.allowed);
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit-metadata contract — the shape Ticket 2 HQ visibility relies on.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("blocked decisions expose the canonical fields HQ visibility surfaces", async () => {
  const admin = makeAdmin({
    org: { id: ORG_A },
    tradeApproval: { id: "ta-11", org_id: ORG_A, status: "pending", valid_until: null },
  });
  const decision = await checkOrgLegitimacy(admin, ORG_A, "poi_mint");
  assert(!decision.allowed);
  // These are the exact keys promoted in the HQ details dialog
  // (src/components/admin/AdminAuditLogs.tsx — POI gate summary).
  assertEquals(typeof decision.reason, "string");        // legitimacy_reason
  assertEquals(typeof decision.gatePosition, "string");  // gate_position
  assertEquals(typeof decision.status, "string");        // trade_approval_status

  // And the stable error code used by the edge function 403 response.
  assertEquals(ORG_NOT_VERIFIED_CODE, "ORG_NOT_VERIFIED");
});

Deno.test("getActiveGovernanceProfile returns id+position when present, defaults otherwise", async () => {
  const adminWith = makeAdmin({
    governanceProfile: { id: "gp-1", verification_gate_position: "wad_only" },
  });
  const a = await getActiveGovernanceProfile(adminWith, ORG_A);
  assertEquals(a.profileId, "gp-1");
  assertEquals(a.position, "wad_only");

  const adminWithout = makeAdmin({ governanceProfile: null });
  const b = await getActiveGovernanceProfile(adminWithout, ORG_A);
  assertEquals(b.profileId, null);
  assertEquals(b.position, "poi_mint");
});
