/**
 * governance-audit_test.ts — Deno tests for the Phase 2 canonical writer.
 *
 * Pure-function coverage: taxonomy, posture requirement, redaction, payload
 * shape, domain mapping. Persistence covered with an in-memory fake admin
 * client; no live DB calls.
 */

import { assertEquals, assertRejects, assertStringIncludes, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPayload,
  CONTROLLED_TAXONOMY,
  domainFor,
  isCriticalEvent,
  redactMetadata,
  validateGovernanceInput,
  writeCriticalGovernanceEvent,
  writeGovernanceEventBestEffort,
  type AdminLike,
  type GovernanceWriteInput,
} from "./governance-audit.ts";

// ── Fake admin client ────────────────────────────────────────────────────────

interface StoredRow {
  id: string;
  org_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  occurred_at: string;
  payload: Record<string, unknown>;
  event_hash: string;
  prev_hash: string | null;
}

function makeFakeAdmin(opts: { failInsert?: boolean } = {}): {
  admin: AdminLike;
  rows: StoredRow[];
} {
  const rows: StoredRow[] = [];
  let counter = 0;

  const admin: AdminLike = {
    from() {
      let table_filter: Record<string, any> = {};
      let table_since: string | null = null;

      const query: any = {
        select(_cols: string) {
          return this;
        },
        eq(col: string, v: any) {
          table_filter[col] = v;
          return this;
        },
        gte(_col: string, v: string) {
          table_since = v;
          return this;
        },
        order(_col: string, _opts: any) {
          return this;
        },
        limit(_n: number) {
          const matched = rows
            .filter((r) =>
              Object.entries(table_filter).every(([k, v]) => (r as any)[k] === v),
            )
            .filter((r) => (table_since ? r.occurred_at >= table_since! : true))
            .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
          return Promise.resolve({ data: matched, error: null });
        },
      };

      return {
        select: (_c: string) => query,
        insert(row: any) {
          return {
            select(_c: string) {
              return {
                async single() {
                  if (opts.failInsert) {
                    return { data: null, error: { message: "simulated insert failure" } };
                  }
                  const id = `evt_${++counter}`;
                  rows.push({ id, ...row });
                  return { data: { id }, error: null };
                },
              };
            },
          };
        },
      } as any;
    },
  };

  return { admin, rows };
}

// ── Tests ────────────────────────────────────────────────────────────────────

const ORG = "11111111-1111-1111-1111-111111111111";
const MATCH = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

function baseCritical(): GovernanceWriteInput {
  return {
    event_type: "poi.state_changed",
    org_id: ORG,
    aggregate_type: "poi",
    aggregate_id: MATCH,
    actor_user_id: USER,
    actor_role: "platform_admin",
    source_function: "poi-transition",
    match_id: MATCH,
    previous_state: "DRAFT",
    new_state: "ELIGIBLE",
    allowed_or_blocked: "allowed",
    posture_snapshot: {
      verification_posture: "Standard",
      policy_version: "v1",
      waiver_applied: false,
      bypass_applied: false,
      demo: false,
    },
  };
}

Deno.test("controlled taxonomy: known names accepted", () => {
  validateGovernanceInput(baseCritical());
});

Deno.test("controlled taxonomy: unknown event name is rejected", () => {
  const input = { ...baseCritical(), event_type: "poi.totally_made_up" };
  let err: Error | null = null;
  try { validateGovernanceInput(input); } catch (e) { err = e as Error; }
  assertExists(err);
  assertStringIncludes(err!.message, "GOV_AUDIT_UNKNOWN_EVENT");
});

Deno.test("posture snapshot required for critical events", () => {
  const input: GovernanceWriteInput = { ...baseCritical() };
  delete (input as any).posture_snapshot;
  let err: Error | null = null;
  try { validateGovernanceInput(input); } catch (e) { err = e as Error; }
  assertExists(err);
  assertStringIncludes(err!.message, "GOV_AUDIT_POSTURE_REQUIRED");
});

Deno.test("posture label must be controlled", () => {
  const input: GovernanceWriteInput = {
    ...baseCritical(),
    posture_snapshot: { verification_posture: "Awesome" as any },
  };
  let err: Error | null = null;
  try { validateGovernanceInput(input); } catch (e) { err = e as Error; }
  assertExists(err);
  assertStringIncludes(err!.message, "GOV_AUDIT_POSTURE_INVALID");
});

Deno.test("posture 'Not recorded' requires posture_reason", () => {
  const input: GovernanceWriteInput = {
    ...baseCritical(),
    posture_snapshot: { verification_posture: "Not recorded" },
  };
  let err: Error | null = null;
  try { validateGovernanceInput(input); } catch (e) { err = e as Error; }
  assertExists(err);
  assertStringIncludes(err!.message, "GOV_AUDIT_POSTURE_REASON_REQUIRED");

  // With reason, accepted:
  validateGovernanceInput({
    ...baseCritical(),
    posture_snapshot: { verification_posture: "Not recorded", posture_reason: "source data unavailable" },
  });
});

Deno.test("non-critical event does NOT require posture", () => {
  validateGovernanceInput({
    event_type: "outreach.sent" as any === "outreach.sent" ? "pending_engagement.outreach_sent" : "pending_engagement.outreach_sent",
    org_id: ORG,
    aggregate_type: "engagement",
    aggregate_id: MATCH,
    actor_user_id: USER,
    source_function: "poi-engagements",
  });
});

Deno.test("redactMetadata strips secrets, tokens, raw payloads", () => {
  const out = redactMetadata({
    safe_field: "ok",
    api_key: "sk_live_abc",
    nested: { password: "pw", raw_payload: { x: 1 }, ok: 2 },
    big: "x".repeat(2500),
  });
  assertEquals(out.safe_field, "ok");
  assertEquals(out.api_key, "[redacted]");
  const nested = out.nested as Record<string, unknown>;
  assertEquals(nested.password, "[redacted]");
  assertEquals(nested.raw_payload, "[redacted]");
  assertEquals(nested.ok, 2);
  assertEquals((out.big as string).endsWith("…[truncated]"), true);
});

Deno.test("buildPayload exposes posture, links, source_function at stable keys", () => {
  const p = buildPayload(baseCritical());
  assertEquals(p.posture, "Standard");
  assertEquals(p.source_function, "poi-transition");
  assertEquals(p.policy_version, "v1");
  assertEquals(p.previous_state, "DRAFT");
  assertEquals(p.new_state, "ELIGIBLE");
  assertEquals((p.links as any).match_id, MATCH);
  assertEquals(p.match_id, MATCH);
});

Deno.test("domain mapping respects event_store CHECK constraint", () => {
  assertEquals(domainFor("poi.state_changed"), "trust");
  assertEquals(domainFor("payment.event_created"), "trade");
  assertEquals(domainFor("admin.hq_decision_recorded"), "core");
  assertEquals(domainFor("memory.record_created"), "core");
  assertEquals(domainFor("legal_hold.applied"), "trust");
});

Deno.test("isCriticalEvent flags both family-based and name-based critical events", () => {
  assertEquals(isCriticalEvent("poi.state_changed"), true);
  assertEquals(isCriticalEvent("admin.hq_decision_recorded"), true);
  assertEquals(isCriticalEvent("admin.mfa_required_denied"), false);
  assertEquals(isCriticalEvent("pending_engagement.outreach_sent"), false);
});

Deno.test("writeCriticalGovernanceEvent persists a row with chained hash", async () => {
  const { admin, rows } = makeFakeAdmin();
  const r1 = await writeCriticalGovernanceEvent(admin, baseCritical());
  const r2 = await writeCriticalGovernanceEvent(admin, {
    ...baseCritical(),
    previous_state: "ELIGIBLE",
    new_state: "COMPLETION_REQUESTED",
  });
  assertEquals(rows.length, 2);
  assertEquals(r1.deduplicated, false);
  assertEquals(r2.deduplicated, false);
  assertEquals(rows[1].prev_hash, rows[0].event_hash);
});

Deno.test("writeCriticalGovernanceEvent throws (fail-closed) on insert failure", async () => {
  const { admin } = makeFakeAdmin({ failInsert: true });
  await assertRejects(
    () => writeCriticalGovernanceEvent(admin, baseCritical()),
    Error,
    "GOV_AUDIT_WRITE_FAILED",
  );
});

Deno.test("idempotency_key dedupes within window", async () => {
  const { admin, rows } = makeFakeAdmin();
  const input = { ...baseCritical(), idempotency_key: "k-1" };
  const a = await writeCriticalGovernanceEvent(admin, input);
  const b = await writeCriticalGovernanceEvent(admin, input);
  assertEquals(rows.length, 1);
  assertEquals(a.event_id, b.event_id);
  assertEquals(b.deduplicated, true);
});

Deno.test("writeCriticalGovernanceEvent refuses non-critical event names", async () => {
  const { admin } = makeFakeAdmin();
  await assertRejects(
    () =>
      writeCriticalGovernanceEvent(admin, {
        ...baseCritical(),
        event_type: "pending_engagement.outreach_sent",
      }),
    Error,
    "GOV_AUDIT_NOT_CRITICAL",
  );
});

Deno.test("writeGovernanceEventBestEffort swallows failure and returns null", async () => {
  const { admin } = makeFakeAdmin({ failInsert: true });
  const result = await writeGovernanceEventBestEffort(admin, {
    event_type: "pending_engagement.outreach_sent",
    org_id: ORG,
    aggregate_type: "engagement",
    aggregate_id: MATCH,
    actor_user_id: USER,
    source_function: "poi-engagements",
  });
  assertEquals(result, null);
});

Deno.test("source_function and actor are mandatory", () => {
  const bad1: GovernanceWriteInput = { ...baseCritical(), source_function: "" };
  let e1: Error | null = null;
  try { validateGovernanceInput(bad1); } catch (e) { e1 = e as Error; }
  assertStringIncludes(e1!.message, "source_function required");

  const bad2: GovernanceWriteInput = { ...baseCritical() };
  delete (bad2 as any).actor_user_id;
  let e2: Error | null = null;
  try { validateGovernanceInput(bad2); } catch (e) { e2 = e as Error; }
  assertStringIncludes(e2!.message, "actor_user_id or system_actor required");
});

Deno.test("CONTROLLED_TAXONOMY contains every spec-required name", () => {
  for (const name of [
    "poi.created", "poi.state_changed", "poi.blocked",
    "wad.check_started", "wad.check_passed", "wad.check_failed",
    "wad.manual_review_required", "wad.passed", "wad.failed",
    "execution.blocked", "execution.permitted",
    "pending_engagement.created", "pending_engagement.outreach_sent",
    "pending_engagement.outreach_blocked", "pending_engagement.binding_review_required",
    "pending_engagement.late_acceptance_recorded",
    "dispute.opened", "dispute.released", "dispute.closed",
    "admin.hq_decision_recorded", "admin.mfa_required_denied",
    "credit.burn_attempted", "credit.burned", "credit.burn_blocked",
    "payment.event_created",
    "finality.recorded", "memory.record_created",
    "export.governance_record_exported", "demo.event_recorded",
  ]) {
    if (!CONTROLLED_TAXONOMY.has(name)) {
      throw new Error(`Missing required taxonomy name: ${name}`);
    }
  }
});
