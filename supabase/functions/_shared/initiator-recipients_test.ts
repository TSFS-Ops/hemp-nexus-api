/**
 * D4c-1 — initiator-recipient resolver tests.
 *
 * These tests pin the SAFETY CONTRACT in `initiator-recipients.ts`:
 * the resolver may only ever return active org_admin / platform_admin
 * users belonging to the INITIATING organisation, and must NEVER
 * touch counterparty / candidate / disputed fields.
 *
 * The tests use a hand-rolled fake client so they can run under Deno
 * without taking a hard dependency on the Supabase SDK chain.
 */

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  resolveInitiatorRecipients,
} from "./initiator-recipients.ts";

type Row = Record<string, unknown>;

function makeClient(
  tables: Record<string, Row[]>,
  options: { failTable?: string } = {},
) {
  // Track which selects were issued so we can prove the resolver
  // never asked for counterparty / candidate columns.
  const selects: Array<{ table: string; cols: string }> = [];

  function buildBuilder(table: string, cols: string) {
    let rows = [...(tables[table] ?? [])];
    selects.push({ table, cols });

    const api: any = {
      eq(col: string, val: unknown) {
        rows = rows.filter((r) => r[col] === val);
        const next = { ...api };
        next.maybeSingle = async () => {
          if (options.failTable === table) {
            return { data: null, error: { message: "boom" } };
          }
          return { data: rows[0] ?? null, error: null };
        };
        // Allow further .eq / .in chaining and final await
        next.then = (resolve: (v: unknown) => unknown) => {
          if (options.failTable === table) {
            return Promise.resolve({
              data: null,
              error: { message: "boom" },
            }).then(resolve);
          }
          return Promise.resolve({ data: rows, error: null }).then(resolve);
        };
        return next;
      },
      in(col: string, vals: unknown[]) {
        rows = rows.filter((r) => vals.includes(r[col]));
        if (options.failTable === table) {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
        return Promise.resolve({ data: rows, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        if (options.failTable === table) {
          return Promise.resolve({
            data: null,
            error: { message: "boom" },
          }).then(resolve);
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };
    return api;
  }

  return {
    from(table: string) {
      return {
        select(cols: string) {
          return buildBuilder(table, cols);
        },
      };
    },
    _selects: selects,
  };
}

const ENG_ID = "00000000-0000-4000-8000-000000000001";
const ORG_INIT = "00000000-0000-4000-8000-0000000000aa";
const ORG_CP = "00000000-0000-4000-8000-0000000000bb";
const ORG_CAND = "00000000-0000-4000-8000-0000000000cc";

const baseTables = (): Record<string, Row[]> => ({
  poi_engagements: [
    {
      id: ENG_ID,
      org_id: ORG_INIT,
      // intentionally include counterparty / candidate fields in the
      // fixture so we can prove the resolver does NOT consult them.
      counterparty_email: "leak@evil.example",
      counterparty_org_id: ORG_CP,
      binding_candidates: [{ org_id: ORG_CAND }],
    },
  ],
  profiles: [
    // Initiator side — should be eligible
    { id: "u-init-admin", email: "INIT-ADMIN@example.com", org_id: ORG_INIT, status: "active" },
    { id: "u-init-platform", email: "platform@example.com", org_id: ORG_INIT, status: "active" },
    { id: "u-init-member", email: "member@example.com", org_id: ORG_INIT, status: "active" },
    { id: "u-init-inactive", email: "inactive@example.com", org_id: ORG_INIT, status: "inactive" },
    // Counterparty / candidate side — must NEVER appear in output
    { id: "u-cp-admin", email: "cp-admin@evil.example", org_id: ORG_CP, status: "active" },
    { id: "u-cand-admin", email: "cand-admin@evil.example", org_id: ORG_CAND, status: "active" },
  ],
  user_roles: [
    { user_id: "u-init-admin", role: "org_admin" },
    { user_id: "u-init-platform", role: "platform_admin" },
    { user_id: "u-init-member", role: "org_member" },
    { user_id: "u-init-inactive", role: "org_admin" },
    { user_id: "u-cp-admin", role: "org_admin" },
    { user_id: "u-cand-admin", role: "org_admin" },
  ],
});

Deno.test("resolver returns only initiating-org admins/owners", async () => {
  const client = makeClient(baseTables());
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assert(res.ok, JSON.stringify(res));
  if (!res.ok) return;
  assertEquals(res.initiating_org_id, ORG_INIT);
  const ids = res.recipients.map((r) => r.user_id).sort();
  assertEquals(ids, ["u-init-admin", "u-init-platform"]);
  // role tagging
  const platform = res.recipients.find((r) => r.user_id === "u-init-platform");
  assertEquals(platform?.role, "platform_admin");
});

Deno.test("resolver does NOT return counterparty / candidate / disputed users", async () => {
  const client = makeClient(baseTables());
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assert(res.ok);
  if (!res.ok) return;
  const emails = res.recipients.map((r) => r.email);
  for (const banned of [
    "cp-admin@evil.example",
    "cand-admin@evil.example",
    "leak@evil.example",
  ]) {
    assert(
      !emails.includes(banned),
      `forbidden recipient leaked: ${banned}`,
    );
  }
  // Prove the resolver never asked the engagement row for counterparty
  // / candidate columns.
  const engSelect = client._selects.find((s) => s.table === "poi_engagements");
  assert(engSelect, "engagement select should have been issued");
  assert(
    !engSelect!.cols.includes("counterparty"),
    `select must not include counterparty fields: ${engSelect!.cols}`,
  );
  assert(
    !engSelect!.cols.includes("binding_candidates"),
    `select must not include binding_candidates: ${engSelect!.cols}`,
  );
});

Deno.test("resolver deduplicates by user_id and email (lowercased)", async () => {
  const tables = baseTables();
  // Add a duplicate role row for the same admin and a second profile
  // with the same email but different id (shouldn't normally happen
  // but guards the dedupe contract).
  tables.user_roles.push({ user_id: "u-init-admin", role: "platform_admin" });
  tables.profiles.push({
    id: "u-init-dupe",
    email: "init-admin@example.com",
    org_id: ORG_INIT,
    status: "active",
  });
  tables.user_roles.push({ user_id: "u-init-dupe", role: "org_admin" });

  const client = makeClient(tables);
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assert(res.ok);
  if (!res.ok) return;
  const emails = res.recipients.map((r) => r.email);
  assertEquals(new Set(emails).size, emails.length);
  // u-init-admin should be promoted to platform_admin role tagging
  const promoted = res.recipients.find((r) => r.user_id === "u-init-admin");
  assertEquals(promoted?.role, "platform_admin");
});

Deno.test("resolver refuses if engagement is missing", async () => {
  const tables = baseTables();
  tables.poi_engagements = [];
  const client = makeClient(tables);
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assertEquals(res.ok, false);
  if (res.ok) return;
  assertEquals(res.reason, "engagement_not_found");
});

Deno.test("resolver refuses if engagement_id is empty", async () => {
  const client = makeClient(baseTables());
  const res = await resolveInitiatorRecipients(client as any, "");
  assertEquals(res.ok, false);
  if (res.ok) return;
  assertEquals(res.reason, "engagement_not_found");
});

Deno.test("resolver refuses if initiating org_id is null", async () => {
  const tables = baseTables();
  tables.poi_engagements = [{ id: ENG_ID, org_id: null }];
  const client = makeClient(tables);
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assertEquals(res.ok, false);
  if (res.ok) return;
  assertEquals(res.reason, "initiating_org_unknown");
});

Deno.test("resolver returns no_eligible_admins when no admin profiles", async () => {
  const tables = baseTables();
  // strip admin roles in initiating org
  tables.user_roles = tables.user_roles.filter(
    (r) => !["u-init-admin", "u-init-platform"].includes(r.user_id as string),
  );
  const client = makeClient(tables);
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assertEquals(res.ok, false);
  if (res.ok) return;
  assertEquals(res.reason, "no_eligible_admins");
});

Deno.test("resolver honours hard-suppression checker (bounce/complaint)", async () => {
  const client = makeClient(baseTables());
  const res = await resolveInitiatorRecipients(
    client as any,
    ENG_ID,
    async (emails) => new Set(emails.filter((e) => e === "init-admin@example.com")),
  );
  assert(res.ok);
  if (!res.ok) return;
  const ids = res.recipients.map((r) => r.user_id);
  assertEquals(ids, ["u-init-platform"]);
});

Deno.test("resolver returns no_eligible_admins when ALL candidates hard-suppressed", async () => {
  const client = makeClient(baseTables());
  const res = await resolveInitiatorRecipients(
    client as any,
    ENG_ID,
    async (emails) => new Set(emails),
  );
  assertEquals(res.ok, false);
  if (res.ok) return;
  assertEquals(res.reason, "no_eligible_admins");
});

Deno.test("resolver propagates lookup_failed on engagement fetch error", async () => {
  const client = makeClient(baseTables(), { failTable: "poi_engagements" });
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assertEquals(res.ok, false);
  if (res.ok) return;
  assertEquals(res.reason, "lookup_failed");
});

Deno.test("resolver result contains no counterparty/candidate detail beyond routing", async () => {
  const client = makeClient(baseTables());
  const res = await resolveInitiatorRecipients(client as any, ENG_ID);
  assert(res.ok);
  if (!res.ok) return;
  const json = JSON.stringify(res);
  for (const leak of [
    "counterparty",
    "candidate",
    "disputed",
    "binding_candidates",
    ORG_CP,
    ORG_CAND,
  ]) {
    assert(
      !json.toLowerCase().includes(leak.toLowerCase()),
      `result leaked "${leak}": ${json}`,
    );
  }
});
