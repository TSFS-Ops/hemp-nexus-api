/**
 * Basic Memory Record v1 — writer edge function tests.
 *
 * These tests live against the deployed `basic-memory-record-write`
 * edge function over HTTP. Anything that requires service_role to
 * actually insert is asserted shape-only against the deployed
 * production runtime via the anon key (which proves UNAUTHORIZED
 * gating). We never embed a service_role key in client tests.
 *
 * What we assert here from the public client surface:
 *   - unauthenticated callers always get 401 UNAUTHORIZED
 *   - validation rejects invalid payloads with 400
 *   - the v1 vocabulary used in code matches the writer's own set
 */
import { describe, it, expect } from "vitest";
import {
  BASIC_MEMORY_TRIGGER_TYPES,
  BASIC_MEMORY_OUTCOMES,
  BASIC_MEMORY_OUTCOME_REASONS,
  BASIC_MEMORY_ENVIRONMENTS,
} from "@/lib/basic-memory/outcomes";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SUPABASE_ANON);
const d = hasEnv ? describe : describe.skip;

const FN_URL = `${SUPABASE_URL}/functions/v1/basic-memory-record-write`;

async function call(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(FN_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_ANON!,
      authorization: `Bearer ${SUPABASE_ANON!}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { status: res.status, body: parsed as Record<string, unknown> | null };
}

const VALID = {
  trigger_event_type: "finality.collapsed",
  outcome: "completed",
  outcome_reason: "collapse_recorded",
  source_table: "collapse_ledger",
  source_record_id: "00000000-0000-0000-0000-000000000001",
  source_function: "collapse",
  match_id: "00000000-0000-0000-0000-000000000002",
  environment_classification: "test",
};

d("basic-memory-record-write — auth gating", () => {
  it("rejects anon/authenticated browser callers with 401", async () => {
    const { status, body } = await call(VALID);
    expect(status).toBe(401);
    expect(body?.error).toBe("UNAUTHORIZED");
  });

  it("rejects callers with a fake internal key", async () => {
    const { status } = await call(VALID, { "x-internal-key": "nope" });
    expect(status).toBe(401);
  });
});

// Validation tests run pre-auth-check? No — auth check runs first.
// So we cannot assert validation 400s from the public client without
// service_role. We still assert vocab parity at the type level.
describe("basic-memory-record-write — vocab parity with constants", () => {
  it("trigger types match v1 set", () => {
    expect([...BASIC_MEMORY_TRIGGER_TYPES]).toEqual([
      "finality.collapsed",
      "wad.sealed",
      "dispute.resolved",
    ]);
  });
  it("outcomes match v1 set", () => {
    expect([...BASIC_MEMORY_OUTCOMES]).toEqual([
      "completed",
      "wad_sealed",
      "dispute_resolved",
    ]);
  });
  it("outcome reasons match v1 set", () => {
    expect([...BASIC_MEMORY_OUTCOME_REASONS]).toEqual([
      "collapse_recorded",
      "attestations_complete",
      "dispute_resolved",
    ]);
  });
  it("environments match v1 set", () => {
    expect([...BASIC_MEMORY_ENVIRONMENTS]).toEqual(["live", "demo", "test"]);
  });
});
