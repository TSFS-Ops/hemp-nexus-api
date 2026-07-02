/**
 * Cluster A — Notification / Webhook / Slack observability local smoke tests.
 *
 * Covers tracker items:
 *   #23 — customer webhook auto-disabled notification (`webhook_record_failure`
 *         RPC + `webhook-retry` wiring).
 *   #29 — admin alert route / Slack failure path in `infra-alerts`.
 *   #69 — Slack / notification failure observability in `notification-dispatch`
 *         via the shared `recordNotificationSkipped` helper.
 *
 * Strategy (matches the token-purchase I1/I2 smoke pattern):
 *   - Runtime coverage of the shared helper (`recordNotificationSkipped`)
 *     with a stubbed Supabase client — zero DB, zero network.
 *   - Source-level guards for the three edge functions and the Batch G
 *     migration prove the wiring that a runtime Deno test cannot exercise
 *     without either an SQL engine (the RPC lives in Postgres) or a live
 *     Slack transport.
 *   - `globalThis.fetch` is replaced with a tripwire that fails any test
 *     touching the network.
 *
 * Explicit non-goals: no real Slack POST, no real email, no real
 * notification dispatch, no DB mutation, no provider call, no cron tick,
 * no secrets required.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { recordNotificationSkipped } from "../_shared/notification-skip-audit.ts";

// ---------------------------------------------------------------------
// Network tripwire — any real fetch during a test is a hard failure.
// ---------------------------------------------------------------------
const REAL_FETCH = globalThis.fetch;
function installFetchTripwire(): string[] {
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    calls.push(url);
    throw new Error(
      `[cluster-a-smoke] real fetch attempted (${url}); tests must be pure in-memory`,
    );
  }) as typeof fetch;
  return calls;
}
function restoreFetch() {
  globalThis.fetch = REAL_FETCH;
}

// ---------------------------------------------------------------------
// Stub Supabase client: records every insert / select and never touches
// a real network or DB.
// ---------------------------------------------------------------------
interface StubInsert { table: string; row: Record<string, unknown> }
interface StubClient {
  inserts: StubInsert[];
  selects: string[];
  // Toggle to simulate a dedupe hit for recordNotificationSkipped.
  existingDedupeHit: boolean;
  from(table: string): unknown;
}

function makeStub(existingDedupeHit = false): StubClient {
  const stub: StubClient = {
    inserts: [],
    selects: [],
    existingDedupeHit,
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          stub.inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        select(_cols?: string) {
          stub.selects.push(table);
          const chain = {
            eq: () => chain,
            gte: () => chain,
            contains: () => chain,
            limit: (_n: number) =>
              Promise.resolve({
                data: stub.existingDedupeHit ? [{ id: "existing" }] : [],
                error: null,
              }),
          };
          return chain;
        },
      };
    },
  };
  return stub;
}

// =====================================================================
// #69 — notification-dispatch Slack failure observability (runtime).
// =====================================================================
Deno.test("#69 recordNotificationSkipped writes dispatcher_unavailable for Slack channel", async () => {
  const calls = installFetchTripwire();
  try {
    const stub = makeStub();
    await recordNotificationSkipped(stub as unknown as never, {
      reason: "dispatcher_unavailable",
      sourceFunction: "notification-dispatch",
      sourceEventType: "compliance.breach.detected",
      channel: "slack",
      orgId: "11111111-1111-1111-1111-111111111111",
      extra: { http_status: 503 },
    });
    assertEquals(calls.length, 0, "no fetch expected");
    assertEquals(stub.inserts.length, 1, "one audit_logs insert expected");
    const [ins] = stub.inserts;
    assertEquals(ins.table, "audit_logs");
    assertEquals(ins.row.action, "notification_skipped");
    assertEquals(ins.row.entity_type, "notification");
    assertEquals(ins.row.org_id, "11111111-1111-1111-1111-111111111111");
    const meta = ins.row.metadata as Record<string, unknown>;
    assertEquals(meta.reason, "dispatcher_unavailable");
    assertEquals(meta.channel, "slack");
    assertEquals(meta.source_function, "notification-dispatch");
    assertEquals(meta.source_event_type, "compliance.breach.detected");
    assertEquals((meta as { http_status?: number }).http_status, 503);
  } finally {
    restoreFetch();
  }
});

Deno.test("#69 recordNotificationSkipped dedupes same-day repeat writes for a target", async () => {
  const calls = installFetchTripwire();
  try {
    const stub = makeStub(/*existingDedupeHit*/ true);
    await recordNotificationSkipped(stub as unknown as never, {
      reason: "dispatcher_unavailable",
      sourceFunction: "notification-dispatch",
      channel: "slack",
      targetId: "target-abc",
    });
    assertEquals(calls.length, 0);
    // Dedupe hit → no insert (only the existence-check select).
    assertEquals(stub.inserts.length, 0);
    assert(stub.selects.includes("audit_logs"));
  } finally {
    restoreFetch();
  }
});

Deno.test("#69 recordNotificationSkipped handles slack_not_configured shape", async () => {
  const calls = installFetchTripwire();
  try {
    const stub = makeStub();
    await recordNotificationSkipped(stub as unknown as never, {
      reason: "slack_not_configured",
      sourceFunction: "notification-dispatch",
      channel: "slack",
    });
    assertEquals(calls.length, 0);
    assertEquals(stub.inserts.length, 1);
    const meta = stub.inserts[0].row.metadata as Record<string, unknown>;
    assertEquals(meta.reason, "slack_not_configured");
    assertEquals(meta.channel, "slack");
  } finally {
    restoreFetch();
  }
});

Deno.test("#69 recordNotificationSkipped never throws on stub insert failure", async () => {
  const calls = installFetchTripwire();
  try {
    const stub = {
      from: (_t: string) => ({
        insert: (_row: Record<string, unknown>) =>
          Promise.resolve({ data: null, error: { message: "simulated" } }),
        select: () => ({
          eq: () => ({
            gte: () => ({
              contains: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }),
            }),
          }),
        }),
      }),
    };
    // Must not throw even though the insert errored.
    await recordNotificationSkipped(stub as unknown as never, {
      reason: "dispatcher_unavailable",
      sourceFunction: "notification-dispatch",
      channel: "slack",
    });
    assertEquals(calls.length, 0);
  } finally {
    restoreFetch();
  }
});

// =====================================================================
// Source-level guards — wiring proof for #23, #29, #69.
// A runtime test cannot exercise a Postgres RPC (#23 auto-disable trip
// lives in `webhook_record_failure`) or a live Slack POST (#29) without
// violating the "no side effects" constraint. These guards assert the
// hardened contracts are present in the committed source.
// =====================================================================

const HERE = new URL(".", import.meta.url).pathname;
const PROJECT_ROOT = HERE.replace(/\/supabase\/functions\/notification-dispatch\/?$/, "");
async function read(rel: string): Promise<string> {
  return await Deno.readTextFile(`${PROJECT_ROOT}/${rel}`);
}

Deno.test("#69 notification-dispatch Slack failure branch records dispatcher_unavailable and sets slackStatus=failed", async () => {
  const src = await read("supabase/functions/notification-dispatch/index.ts");
  // Both branches (non-OK response, thrown fetch) must record + flip status.
  assertStringIncludes(src, `channel: "slack"`);
  assertStringIncludes(src, `reason: "dispatcher_unavailable"`);
  assertStringIncludes(src, `slackStatus = "failed"`);
  // Typed envelope declared exactly.
  assert(
    /"sent"\s*\|\s*"skipped_not_configured"\s*\|\s*"failed"\s*\|\s*"not_requested"/.test(src),
    "slack_status envelope must expose the four canonical values",
  );
});

Deno.test("#69 notification-dispatch Slack-not-configured branch records slack_not_configured", async () => {
  const src = await read("supabase/functions/notification-dispatch/index.ts");
  assertStringIncludes(src, `reason: "slack_not_configured"`);
  assertStringIncludes(src, `slackStatus = "skipped_not_configured"`);
});

Deno.test("#29 infra-alerts Slack dispatch failure is caught and does not propagate", async () => {
  const src = await read("supabase/functions/infra-alerts/index.ts");
  // Slack fetch wrapped in try/catch with console.error, response still 200.
  assert(
    /settings\.slackWebhook[\s\S]*?try\s*\{[\s\S]*?fetch\(settings\.slackWebhook[\s\S]*?catch\s*\(err\)\s*\{[\s\S]*?Slack dispatch failed/.test(src),
    "infra-alerts Slack branch must be try/catch-wrapped with the canonical console.error marker",
  );
  // The observability windows added by Batch G still present (see also #23).
  assertStringIncludes(src, `Slack Dispatcher Unavailable (1 hr)`);
  assertStringIncludes(src, `.eq("reason", "dispatcher_unavailable")`);
  assertStringIncludes(src, `Webhook Auto-Disable (1 hr)`);
  assertStringIncludes(src, `.eq("kind", "webhook_auto_disabled")`);
});

Deno.test("#23 Batch G migration writes webhook.endpoint.auto_disabled audit + admin_risk_items + platform_admin notification", async () => {
  // Locate the Batch G migration by content marker (filenames are opaque).
  const migsDir = `${PROJECT_ROOT}/supabase/migrations`;
  let sql = "";
  for await (const entry of Deno.readDir(migsDir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const body = await Deno.readTextFile(`${migsDir}/${entry.name}`);
    if (/webhook_record_failure/.test(body) && /webhook_auto_disabled/.test(body)) {
      sql = body;
      break;
    }
  }
  assert(sql.length > 0, "Batch G webhook_record_failure migration must exist");
  assertStringIncludes(sql, "'webhook.endpoint.auto_disabled'");
  assertStringIncludes(sql, "INSERT INTO public.audit_logs");
  assertStringIncludes(sql, "'webhook_auto_disabled'");
  assertStringIncludes(sql, "INSERT INTO public.admin_risk_items");
  assertStringIncludes(sql, "ON CONFLICT (dedup_key) DO NOTHING");
  assertStringIncludes(sql, "INSERT INTO public.notifications");
  assert(
    /role\s*=\s*'platform_admin'/.test(sql),
    "notifications insert must target platform_admin recipients",
  );
  // Observability inserts must be exception-wrapped so the counter/trip
  // contract is preserved even if audit/risk/notification writes fail.
  const exceptionBlocks = sql.match(/EXCEPTION WHEN OTHERS THEN/g) ?? [];
  assert(
    exceptionBlocks.length >= 3,
    `expected >=3 EXCEPTION guards, got ${exceptionBlocks.length}`,
  );
  // No raw payload leakage.
  assert(
    !/payload_body|request_body|response_body/.test(sql),
    "auto-disable observability must not store raw webhook payloads",
  );
});

Deno.test("#23 webhook-retry wires both failure branches into webhook_record_failure RPC", async () => {
  const src = await read("supabase/functions/webhook-retry/index.ts");
  // Two RPC call sites (non-OK response branch + network-error catch).
  const rpcCalls = src.match(/webhook_record_failure/g) ?? [];
  assert(
    rpcCalls.length >= 2,
    `expected webhook-retry to call webhook_record_failure in both failure branches, got ${rpcCalls.length}`,
  );
  // Threshold matches the migration default.
  assertStringIncludes(src, "p_threshold: 10");
  // Trip result is inspected (tripped flag drives the [CIRCUIT BREAKER] warn).
  assertStringIncludes(src, "[CIRCUIT BREAKER] Tripped");
});
