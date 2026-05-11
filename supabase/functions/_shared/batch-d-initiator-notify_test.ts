/**
 * D4c-2 — initiator notification helper tests.
 *
 * Pins the SAFETY CONTRACT in `batch-d-initiator-notify.ts`:
 *   - allowlist enforcement;
 *   - catalogue invariants;
 *   - wording guard;
 *   - hard-suppression vs marketing-unsubscribe split;
 *   - dedupe;
 *   - audit metadata redaction (no counterparty PII; emails hashed);
 *   - subject clamping;
 *   - no production trigger wiring (helper invoked directly).
 *
 * Tests use hand-rolled fakes so they run under Deno without taking a
 * hard dependency on the Supabase SDK chain.
 */

import {
  assertEquals,
  assert,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dispatchD4cInitiatorAlert,
  D4C_INITIATOR_ALLOWLIST,
  type D4cInitiatorNotifyDeps,
  type QueuedEmailArgs,
  type QueuedEmailResult,
} from "./batch-d-initiator-notify.ts";
import type {
  HardSuppressionChecker,
  ResolveInitiatorRecipientsResult,
} from "./initiator-recipients.ts";

// ─────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────

interface AuditRow {
  action: string;
  entity_id: string | null;
  org_id: string;
  metadata: Record<string, unknown>;
}

interface FakeSupabase {
  client: any;
  audits: AuditRow[];
  invocations: Array<{ fn: string; body: unknown }>;
  setExistingDedupeRows: (rows: { event_type: string; dedupe_key: string }[]) => void;
}

function makeFakeSupabase(): FakeSupabase {
  const audits: AuditRow[] = [];
  const invocations: Array<{ fn: string; body: unknown }> = [];
  let dedupeRows: { event_type: string; dedupe_key: string }[] = [];

  const auditQuery = (filter: {
    action?: string;
    entity_id?: string;
    contains?: Record<string, unknown>;
  }) => {
    return audits.filter((a) => {
      if (filter.action && a.action !== filter.action) return false;
      if (filter.entity_id && a.entity_id !== filter.entity_id) return false;
      if (filter.contains) {
        for (const [k, v] of Object.entries(filter.contains)) {
          if ((a.metadata as Record<string, unknown>)[k] !== v) return false;
        }
      }
      return true;
    });
  };

  const client: any = {
    from(table: string) {
      const state: any = {
        _table: table,
        _filter: {} as any,
        _contains: {} as any,
      };
      const builder: any = {
        select(_cols: string) {
          return chain;
        },
        insert(row: AuditRow) {
          if (table === "audit_logs") {
            audits.push(row);
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
      const chain: any = {
        eq(col: string, val: unknown) {
          state._filter[col] = val;
          return chain;
        },
        gte(_col: string, _val: unknown) {
          return chain;
        },
        contains(_col: string, val: Record<string, unknown>) {
          Object.assign(state._contains, val);
          return chain;
        },
        limit(_n: number) {
          if (table === "audit_logs") {
            // Simulate dedupe: if a matching dedupeRow exists, return one row.
            const matchedDedupe = dedupeRows.find(
              (d) =>
                d.event_type === state._contains.event_type &&
                d.dedupe_key === state._contains.dedupe_key,
            );
            if (matchedDedupe) {
              return Promise.resolve({
                data: [{ id: "x" }],
                error: null,
              });
            }
            // Otherwise check live audit rows.
            const found = auditQuery({
              action: state._filter.action,
              entity_id: state._filter.entity_id,
              contains: state._contains,
            });
            return Promise.resolve({
              data: found.length ? [{ id: "x" }] : [],
              error: null,
            });
          }
          return Promise.resolve({ data: [], error: null });
        },
      };
      return builder;
    },
    functions: {
      invoke(fn: string, opts: { body: unknown }) {
        invocations.push({ fn, body: opts.body });
        return Promise.resolve({ data: { ok: true }, error: null });
      },
    },
    rpc(_name: string, _args: unknown) {
      return Promise.resolve({ data: null, error: null });
    },
  };

  return {
    client,
    audits,
    invocations,
    setExistingDedupeRows(rows) {
      dedupeRows = rows;
    },
  };
}

function fakeResolverOk(
  recipients: { user_id: string; email: string; role: "org_admin" | "platform_admin" }[],
  initiatingOrgId = "org-init",
  hardSuppressedSet?: Set<string>,
) {
  return async (
    _client: unknown,
    engagementId: string,
    checker?: HardSuppressionChecker,
  ): Promise<ResolveInitiatorRecipientsResult> => {
    let remaining = recipients;
    if (checker && hardSuppressedSet) {
      const supp = await checker(recipients.map((r) => r.email));
      remaining = recipients.filter((r) => !supp.has(r.email));
      if (remaining.length === 0) {
        return {
          ok: false,
          engagement_id: engagementId,
          reason: "no_eligible_admins",
          detail: "all candidates hard-suppressed",
        };
      }
    }
    return {
      ok: true,
      engagement_id: engagementId,
      initiating_org_id: initiatingOrgId,
      recipients: remaining,
    };
  };
}

function fakeResolverFail(
  reason:
    | "engagement_not_found"
    | "initiating_org_unknown"
    | "no_eligible_admins"
    | "lookup_failed",
  detail?: string,
) {
  return async (
    _client: unknown,
    engagementId: string,
  ): Promise<ResolveInitiatorRecipientsResult> => ({
    ok: false,
    engagement_id: engagementId,
    reason,
    detail,
  });
}

function captureEnqueue() {
  const calls: QueuedEmailArgs[] = [];
  const fn = async (args: QueuedEmailArgs): Promise<QueuedEmailResult> => {
    calls.push(args);
    return { ok: true };
  };
  return { fn, calls };
}

const baseEng = "11111111-1111-1111-1111-111111111111";

function baseDeps(extra: Partial<D4cInitiatorNotifyDeps> = {}): D4cInitiatorNotifyDeps {
  return {
    resolveRecipients: fakeResolverOk([
      { user_id: "u1", email: "alice@example.com", role: "org_admin" },
    ]),
    hardSuppressionChecker: async () => new Set<string>(),
    enqueueEmail: async () => ({ ok: true }),
    hashEmail: async (e: string) => `sha256:${e.length}:${e.charCodeAt(0).toString(16)}`,
    now: () => new Date("2026-05-11T12:00:00Z"),
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

Deno.test("D4c-2 :: allowed event queues initiator alert for org admin", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assert(result.ok);
  if (result.ok && !("deduped" in result && result.deduped)) {
    assertEquals(result.queuedCount, 1);
  }
  assertEquals(cap.calls.length, 1);
  assertEquals(cap.calls[0].templateName, "batch-d-initiator-alert");
  assertEquals(cap.calls[0].recipientEmail, "alice@example.com");
  assert(cap.calls[0].subject.length <= 200);
  // Audit row written
  const queued = fake.audits.find(
    (a) => a.action === "engagement.initiator_alert_queued",
  );
  assert(queued, "queued audit row missing");
});

Deno.test("D4c-2 :: unknown event is refused (event_not_in_allowlist)", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.totally_made_up",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.reason, "event_not_in_allowlist");
  assertEquals(cap.calls.length, 0);
  assert(
    fake.audits.some((a) => a.action === "engagement.initiator_alert_skipped"),
  );
});

Deno.test("D4c-2 :: catalogue allowlist excludes outreach.blocked.* events", () => {
  for (const ev of D4C_INITIATOR_ALLOWLIST) {
    assertFalse(
      ev.startsWith("outreach.blocked"),
      `outreach.blocked.* must not be in D4c-2 allowlist (saw ${ev})`,
    );
  }
});

Deno.test("D4c-2 :: event that forbids initiating_org_admin is refused", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      // binding_review_required has initiating_org_admin in forbiddenRecipients
      eventType: "engagement.binding_review_required",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.reason, "wording_forbids_initiating_org");
  assertEquals(cap.calls.length, 0);
});

Deno.test("D4c-2 :: event that does not allow initiating_org_admin is refused", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      // binding_review_resolved allowedRecipients = [platform_admin]
      eventType: "engagement.binding_review_resolved",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assertFalse(result.ok);
  if (!result.ok) {
    assert(
      result.reason === "wording_disallows_initiating_org" ||
        result.reason === "wording_forbids_initiating_org",
    );
  }
  assertEquals(cap.calls.length, 0);
});

Deno.test("D4c-2 :: recipient resolver failure → skipped audit, no queue", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({
      resolveRecipients: fakeResolverFail("engagement_not_found"),
      enqueueEmail: cap.fn,
    }),
  );
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.reason, "recipient_resolution_failed");
  assertEquals(cap.calls.length, 0);
  assert(
    fake.audits.some((a) => a.action === "engagement.initiator_alert_skipped"),
  );
});

Deno.test("D4c-2 :: hard-suppressed (bounce) recipient is skipped", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const recipients = [
    { user_id: "u1", email: "alice@example.com", role: "org_admin" as const },
  ];
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({
      resolveRecipients: fakeResolverOk(
        recipients,
        "org-init",
        new Set(["alice@example.com"]),
      ),
      hardSuppressionChecker: async (emails) =>
        new Set(emails.filter((e) => e === "alice@example.com")),
      enqueueEmail: cap.fn,
    }),
  );
  assertFalse(result.ok);
  if (!result.ok) assertEquals(result.reason, "all_recipients_hard_suppressed");
  assertEquals(cap.calls.length, 0);
});

Deno.test("D4c-2 :: marketing 'unsubscribe' does NOT block operational notice", async () => {
  // Caller's hard-suppression checker only flags bounce/complaint.
  // An email with reason='unsubscribe' is not in the suppressed set,
  // so the helper must queue.
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({
      hardSuppressionChecker: async () => new Set(), // unsubscribe NOT included
      enqueueEmail: cap.fn,
    }),
  );
  assert(result.ok);
  assertEquals(cap.calls.length, 1);
  // Audit confirms the operational-override flag.
  const queued = fake.audits.find(
    (a) => a.action === "engagement.initiator_alert_queued",
  );
  assert(queued);
  assertEquals(
    queued?.metadata.marketing_unsubscribe_ignored_for_operational_notice,
    true,
  );
});

Deno.test("D4c-2 :: repeated same event/dedupe key does not enqueue duplicate", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const args = {
    eventType: "engagement.late_acceptance_pending_reconfirmation",
    engagementId: baseEng,
    sourceFunction: "test-suite",
  };
  const r1 = await dispatchD4cInitiatorAlert(
    fake.client,
    args,
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assert(r1.ok);
  assertEquals(cap.calls.length, 1);
  const r2 = await dispatchD4cInitiatorAlert(
    fake.client,
    args,
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assert(r2.ok);
  assert("deduped" in r2 && r2.deduped === true);
  assertEquals(cap.calls.length, 1, "no second enqueue on dedupe");
});

Deno.test("D4c-2 :: helper does not derive recipients from counterparty/candidate fields", async () => {
  // Resolver receives a "client" object. The helper must not invoke the
  // client.from('poi_engagements').select with counterparty_*, candidate_*,
  // disputed_*, or binding_candidates columns. We assert this by
  // recording every column string passed to .select on the helper's
  // OWN code path. The default resolver is replaced with a fake that
  // records nothing; the helper's responsibility is simply not to read
  // counterparty fields directly. This test pins that contract by
  // confirming the helper never calls client.from('poi_engagements')
  // before delegating to the injected resolver.
  const fake = makeFakeSupabase();
  let helperTouchedEngagementsTable = false;
  const tracingClient: any = {
    ...fake.client,
    from(table: string) {
      if (table === "poi_engagements") helperTouchedEngagementsTable = true;
      return fake.client.from(table);
    },
    functions: fake.client.functions,
  };
  await dispatchD4cInitiatorAlert(
    tracingClient,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps(),
  );
  assertFalse(
    helperTouchedEngagementsTable,
    "helper must not read poi_engagements directly; recipient derivation belongs to resolveInitiatorRecipients",
  );
});

Deno.test("D4c-2 :: audit metadata contains no counterparty PII; emails are hashed", async () => {
  const fake = makeFakeSupabase();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
      // Caller defies the contract — helper must strip these.
      metadata: {
        counterparty_email: "evil@bad.example",
        counterparty_name: "Evil Co",
        candidate_org_id: "abc",
        binding_candidates: ["x"],
        disputed_party: "noisy",
        commodity: "Copper",
        innocuous_field: "kept",
      },
    },
    baseDeps(),
  );
  assert(result.ok);
  const queued = fake.audits.find(
    (a) => a.action === "engagement.initiator_alert_queued",
  );
  assert(queued);
  const meta = queued!.metadata as Record<string, any>;
  // Banned keys stripped from caller_metadata
  for (const banned of [
    "counterparty_email",
    "counterparty_name",
    "candidate_org_id",
    "binding_candidates",
    "disputed_party",
    "commodity",
  ]) {
    assertFalse(
      Object.prototype.hasOwnProperty.call(meta.caller_metadata, banned),
      `banned key ${banned} must be stripped from caller_metadata`,
    );
  }
  assertEquals(meta.caller_metadata.innocuous_field, "kept");
  // Top-level metadata must not contain plain emails
  const json = JSON.stringify(meta);
  assertFalse(
    json.includes("alice@example.com"),
    "plain recipient email must not appear in audit metadata",
  );
  assertFalse(
    json.includes("evil@bad.example"),
    "banned counterparty email must not appear in audit metadata",
  );
  // Email hashes present
  assert(Array.isArray(meta.recipient_emails_hash));
  assertEquals(meta.recipient_emails_hash[0], "hash(alice@example.com)");
  // Required classification fields
  assertEquals(meta.classification, "transactional_operational");
  assertEquals(meta.suppression_checked, true);
  assertEquals(meta.marketing_unsubscribe_ignored_for_operational_notice, true);
});

Deno.test("D4c-2 :: subject and body pass forbidden-word guard", async () => {
  // Loop every allowlisted event and confirm the helper composes a
  // wording-clean subject & body. We assert by verifying the helper
  // either queues OK or refuses for a non-wording reason.
  for (const ev of D4C_INITIATOR_ALLOWLIST) {
    const fake = makeFakeSupabase();
    const cap = captureEnqueue();
    const result = await dispatchD4cInitiatorAlert(
      fake.client,
      {
        eventType: ev,
        engagementId: baseEng,
        sourceFunction: "test-suite",
      },
      baseDeps({ enqueueEmail: cap.fn }),
    );
    if (!result.ok) {
      assertFalse(
        result.reason === "wording_forbidden_word",
        `event ${ev} produced forbidden-word wording`,
      );
    }
  }
});

Deno.test("D4c-2 :: subject is clamped to <= 200 chars and includes engagement trace tail", async () => {
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const longEng = "deadbeef-".repeat(8) + "1234";
  await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: longEng,
      sourceFunction: "test-suite",
    },
    baseDeps({ enqueueEmail: cap.fn }),
  );
  assertEquals(cap.calls.length, 1);
  const subj = cap.calls[0].subject;
  assert(subj.length <= 200);
  assert(subj.includes(longEng.slice(0, 8)), "trace tail must be preserved");
});

Deno.test("D4c-2 :: no counterparty/candidate/disputed recipient path exists in allowlist enforcement", async () => {
  // Simulate a resolver that — defying its own contract — returns a
  // counterparty-looking recipient. The helper should still treat that
  // as the resolver's verdict (the resolver is the chokepoint), but
  // critically: there is NO branch in the helper that derives recipients
  // any other way. This test pins that by injecting a resolver that
  // returns zero recipients and asserting the helper does NOT fall
  // back to any other source.
  const fake = makeFakeSupabase();
  const cap = captureEnqueue();
  const result = await dispatchD4cInitiatorAlert(
    fake.client,
    {
      eventType: "engagement.late_acceptance_pending_reconfirmation",
      engagementId: baseEng,
      sourceFunction: "test-suite",
    },
    baseDeps({
      resolveRecipients: fakeResolverFail(
        "no_eligible_admins",
        "all candidates hard-suppressed",
      ),
      enqueueEmail: cap.fn,
    }),
  );
  assertFalse(result.ok);
  if (!result.ok) {
    assertEquals(result.reason, "all_recipients_hard_suppressed");
  }
  assertEquals(cap.calls.length, 0);
});
