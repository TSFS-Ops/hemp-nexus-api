/**
 * Deno tests for the Phase 2 governance-audit integration helper.
 * Verifies posture snapshot construction, idempotency-key derivation,
 * critical-event taxonomy enforcement, fail-closed behaviour, and
 * best-effort fallback.
 */
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPostureSnapshot,
  deriveIdempotencyKey,
  writeCriticalEventWithPosture,
} from "./governance-audit-integration.ts";
import { writeGovernanceEventBestEffort } from "./governance-audit.ts";

// ── Fake admin client ────────────────────────────────────────────────────────

function makeFakeAdmin(behaviour: {
  insertError?: { message: string } | null;
  existingIdempotent?: { id: string } | null;
}) {
  const inserts: any[] = [];
  const client = {
    inserts,
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq() { return this; },
            gte() { return this; },
            order() { return this; },
            limit() {
              if (behaviour.existingIdempotent) {
                return Promise.resolve({
                  data: [{
                    id: behaviour.existingIdempotent.id,
                    occurred_at: new Date().toISOString(),
                    payload: { idempotency_key: "match-key" },
                  }],
                  error: null,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
        },
        insert(row: any) {
          inserts.push(row);
          return {
            select(_cols: string) {
              return {
                single() {
                  if (behaviour.insertError) {
                    return Promise.resolve({ data: null, error: behaviour.insertError });
                  }
                  return Promise.resolve({ data: { id: "evt-" + inserts.length }, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  return client;
}

Deno.test("buildPostureSnapshot sets defaults and posture_reason", () => {
  const p = buildPostureSnapshot("Standard", { policy_version: "v1" });
  assertEquals(p.verification_posture, "Standard");
  assertEquals(p.policy_version, "v1");
  assertEquals(p.waiver_applied, false);

  const np = buildPostureSnapshot("Not recorded");
  assertEquals(np.posture_reason, "source data unavailable");
});

Deno.test("deriveIdempotencyKey is deterministic", () => {
  const a = deriveIdempotencyKey({
    aggregate_id: "agg",
    event_type: "poi.state_changed",
    request_id: "r1",
    extra: "DRAFT->PENDING",
  });
  const b = deriveIdempotencyKey({
    aggregate_id: "agg",
    event_type: "poi.state_changed",
    request_id: "r1",
    extra: "DRAFT->PENDING",
  });
  assertEquals(a, b);
});

Deno.test("writeCriticalEventWithPosture inserts a controlled event", async () => {
  const admin = makeFakeAdmin({});
  const result = await writeCriticalEventWithPosture(admin as any, {
    event_type: "poi.state_changed",
    org_id: "org-1",
    aggregate_type: "match",
    aggregate_id: "match-1",
    actor_user_id: "user-1",
    source_function: "unit-test",
    request_id: "req-1",
    previous_state: "DRAFT",
    new_state: "PENDING_APPROVAL",
    allowed_or_blocked: "allowed",
    posture: buildPostureSnapshot("Standard"),
  });
  assert(result.event_id.startsWith("evt-"));
  assertEquals(result.deduplicated, false);
  const row = admin.inserts[0];
  assertEquals(row.event_type, "poi.state_changed");
  assertEquals(row.payload.previous_state, "DRAFT");
  assertEquals(row.payload.new_state, "PENDING_APPROVAL");
  assertEquals(row.payload.posture_snapshot.verification_posture, "Standard");
  assert(row.payload.idempotency_key, "idempotency_key must be derived");
});

Deno.test("writeCriticalEventWithPosture throws on insert error (fail-closed)", async () => {
  const admin = makeFakeAdmin({ insertError: { message: "boom" } });
  await assertRejects(
    () =>
      writeCriticalEventWithPosture(admin as any, {
        event_type: "credit.burned",
        org_id: "org-1",
        aggregate_type: "credit_burn",
        aggregate_id: "org-1",
        actor_user_id: null,
        system_actor: "unit-test",
        source_function: "unit-test",
        posture: buildPostureSnapshot("Standard"),
      }),
    Error,
    "GOV_AUDIT_WRITE_FAILED",
  );
});

Deno.test("writeCriticalEventWithPosture rejects non-critical event names", async () => {
  const admin = makeFakeAdmin({});
  await assertRejects(
    () =>
      writeCriticalEventWithPosture(admin as any, {
        event_type: "demo.event_recorded",
        org_id: "org-1",
        aggregate_type: "demo",
        aggregate_id: "x",
        actor_user_id: "u",
        source_function: "unit-test",
        posture: buildPostureSnapshot("Standard"),
      }),
    Error,
    "GOV_AUDIT_NOT_CRITICAL",
  );
});

Deno.test("writeGovernanceEventBestEffort resolves null on failure", async () => {
  const admin = makeFakeAdmin({ insertError: { message: "boom" } });
  const r = await writeGovernanceEventBestEffort(admin as any, {
    event_type: "credit.burn_blocked",
    org_id: "org-1",
    aggregate_type: "credit_burn",
    aggregate_id: "org-1",
    actor_user_id: null,
    system_actor: "unit-test",
    source_function: "unit-test",
    posture_snapshot: buildPostureSnapshot("Standard"),
  });
  assertEquals(r, null);
});
