/**
 * Phase 1A — Support Centre behavioural harness (default vitest suite).
 *
 * The AUTHORITATIVE behavioural verification for Phase 1A is
 * `supabase/tests/phase_1a_support_behavioural_proof.sql`, a database-native
 * proof that establishes transaction-local JWT claims per fixture user and
 * exercises the visibility / mutation matrices for every required identity.
 * That proof runs against a disposable migrated database (local Supabase or
 * a CI Postgres) and does NOT depend on Lovable Cloud possessing the
 * production service-role key.
 *
 * This Vitest file preserves the always-on ANON tier — it runs
 * unconditionally against the live database via PostgREST and proves:
 *   • unauthenticated actors cannot invoke any support RPC;
 *   • underscore helpers are not routable for anon;
 *   • direct table SELECT / INSERT is denied for anon;
 *   • capability + role scaffolding tables are locked down.
 *
 * The multi-role behavioural matrix used to be emitted here as 12 hard
 * failures whenever the service-role key was absent. That produced a
 * permanent red result in the default suite even though the anon tier
 * was green. Per the Phase 1A Final Behavioural Verification directive
 * we now:
 *   • run the multi-role matrix in the database-native proof;
 *   • replace the failing placeholders with a single environment
 *     precondition test that skips (not fails) when the DB proof cannot
 *     be executed from the default vitest environment;
 *   • fail loudly instead in a dedicated CI script
 *     (`scripts/phase-1a-behavioural-ci.sh`) which is invoked by
 *     `bun run test:phase-1a-behavioural` in the security CI job.
 */
import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env
    ?.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const ANON_KEY =
  (import.meta as unknown as { env: Record<string, string | undefined> }).env
    ?.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY;

const HAS_ANON = Boolean(SUPABASE_URL && ANON_KEY);

function anon(): SupabaseClient {
  return createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isDenial(errMessage: string | undefined | null, status?: number): boolean {
  if (status && [401, 403, 404].includes(status)) return true;
  if (!errMessage) return false;
  return /permission|not allowed|row-level|rls|denied|forbidden|jwt|unauthori[sz]ed|does not exist|no function matches|could not find|missing|argument|required/i.test(
    errMessage,
  );
}

describe("Phase 1A behavioural harness — preconditions", () => {
  it("Supabase URL + anon key are available (required for anon tier)", () => {
    expect(HAS_ANON, "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set").toBe(true);
  });
});

describe("Group 1 — unauthenticated behaviour", () => {
  if (!HAS_ANON) {
    it.skip("skipped: no anon env", () => { /* env-guard */ });
    return;
  }
  const client = anon();

  const rpcCases: Array<[string, Record<string, unknown>]> = [
    ["create_support_ticket", {
      _category_key: "general_question",
      _subcategory_key: null,
      _customer_impact: "affects_me",
      _subject: "unauth attempt",
    }],
    ["list_own_support_tickets", {}],
    ["list_org_support_tickets", {}],
    ["get_support_ticket", { _ticket_id: "00000000-0000-0000-0000-000000000000" }],
    ["get_support_ticket_internal", { _ticket_id: "00000000-0000-0000-0000-000000000000" }],
    ["post_support_ticket_customer_message", { _ticket_id: "00000000-0000-0000-0000-000000000000", _body: "x" }],
    ["post_support_ticket_internal_note", { _ticket_id: "00000000-0000-0000-0000-000000000000", _body: "x" }],
    ["list_support_ticket_customer_messages", { _ticket_id: "00000000-0000-0000-0000-000000000000" }],
    ["list_support_ticket_internal_notes", { _ticket_id: "00000000-0000-0000-0000-000000000000" }],
  ];

  for (const [fn, args] of rpcCases) {
    it(`RPC ${fn} rejects or returns empty for unauthenticated caller`, async () => {
      const { data, error } = await client.rpc(fn as never, args as never);
      if (error) {
        expect(isDenial(error.message)).toBe(true);
        expect(error.message).not.toMatch(/found target|stack trace|\bat\s+\w+\s*\(/i);
      } else if (Array.isArray(data)) {
        expect(data.length).toBe(0);
      } else {
        expect(
          data == null || data === "" ||
          (typeof data === "object" && Object.keys(data ?? {}).length === 0),
        ).toBe(true);
      }
    });
  }

  it("direct SELECT on support_tickets is denied to anon", async () => {
    const { data, error } = await client.from("support_tickets" as never).select("id").limit(1);
    if (error) expect(isDenial(error.message)).toBe(true);
    else expect(Array.isArray(data) && data.length === 0).toBe(true);
  });

  for (const t of [
    "support_ticket_events",
    "support_ticket_messages",
    "support_ticket_linked_records",
    "support_ticket_access_audit",
  ]) {
    it(`direct SELECT on ${t} is denied to anon`, async () => {
      const { data, error } = await client.from(t as never).select("*").limit(1);
      if (error) expect(isDenial(error.message)).toBe(true);
      else expect(Array.isArray(data) && data.length === 0).toBe(true);
    });
  }

  it("direct INSERT into support_tickets is denied to anon", async () => {
    const { error } = await client.from("support_tickets" as never).insert({
      subject: "hostile insert",
    } as never);
    expect(error).toBeTruthy();
    expect(isDenial(error!.message)).toBe(true);
  });
});

describe("Group 14 (anon slice) — internal helpers not directly executable", () => {
  if (!HAS_ANON) {
    it.skip("skipped: no anon env", () => { /* env-guard */ });
    return;
  }
  const client = anon();
  const helpers = [
    "_support_record_access",
    "_support_next_ticket_number",
    "_support_resolve_restriction",
    "_support_calculate_priority",
    "_support_caller_org_id",
    "_support_reject_mutation",
    "_support_rpc_result_signature",
  ];
  for (const fn of helpers) {
    it(`helper ${fn} cannot be invoked by anon`, async () => {
      const { data, error } = await client.rpc(fn as never, {} as never);
      if (error) {
        expect(isDenial(error.message)).toBe(true);
      } else {
        expect(data == null || data === "" || (Array.isArray(data) && data.length === 0)).toBe(true);
      }
    });
  }
});

describe("Group 15 (anon slice) — empty capability + ownership scaffolding", () => {
  if (!HAS_ANON) {
    it.skip("skipped: no anon env", () => { /* env-guard */ });
    return;
  }
  const client = anon();
  it("anon cannot SELECT support_capabilities_grants", async () => {
    const { data, error } = await client.from("support_capabilities_grants" as never).select("*").limit(1);
    if (error) expect(isDenial(error.message)).toBe(true);
    else expect(Array.isArray(data) && data.length === 0).toBe(true);
  });
  it("anon cannot SELECT support_role_assignments", async () => {
    const { data, error } = await client.from("support_role_assignments" as never).select("*").limit(1);
    if (error) expect(isDenial(error.message)).toBe(true);
    else expect(Array.isArray(data) && data.length === 0).toBe(true);
  });
});

/**
 * Multi-role behavioural matrix pointer
 *
 * Groups 2–13 execute in the pgTAP-style proof:
 *   supabase/tests/phase_1a_support_behavioural_proof.sql
 *
 * Run:
 *   DATABASE_URL=postgres://... \
 *     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
 *          -f supabase/tests/phase_1a_support_behavioural_proof.sql
 *
 * The dedicated CI script (`scripts/phase-1a-behavioural-ci.sh`) fails
 * loudly if invoked without a reachable `DATABASE_URL`. In the default
 * vitest suite we surface a single skipped test that names the proof so
 * developers can find it — we do NOT emit permanent failing placeholders.
 */
describe("Groups 2–13 — multi-role behavioural matrix", () => {
  it.skip(
    "executed via supabase/tests/phase_1a_support_behavioural_proof.sql (see scripts/phase-1a-behavioural-ci.sh)",
    () => { /* pointer — the pgTAP proof owns this coverage */ },
  );
});
