/**
 * Before/after state capture for wrong-action tests.
 *
 * Uses the service-role key (CI-only) to read a stable snapshot of a
 * record so the "no mutation" assertion is authoritative — RLS-scoped
 * reads from a denied user would themselves return nothing, making
 * "no mutation" trivially true. Service-role read is required to prove
 * the row really did not change.
 *
 * Refuses to run in production: requires E2E_RN_ENV ∈ {staging,test}.
 */
import { createClient } from "@supabase/supabase-js";
import type { RecordKey } from "../fixtures/records";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`state.ts: missing env ${name}`);
  return v;
}

function adminClient() {
  const env = process.env.E2E_RN_ENV;
  if (env !== "staging" && env !== "test") {
    throw new Error(`state.ts: refuses to run with E2E_RN_ENV=${env}. Must be staging|test.`);
  }
  return createClient(
    envOrThrow("SUPABASE_URL"),
    envOrThrow("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } },
  );
}

const TABLE: Record<RecordKey, string> = {
  tradeRequestId: "trade_requests",
  matchId: "matches",
  poiId: "pois",
  wadId: "wads",
  documentId: "match_documents",
  refundRequestId: "refund_requests",
  governanceExportId: "export_requests",
  apiKeyId: "api_keys",
};

export async function captureState(key: RecordKey, id: string): Promise<unknown> {
  const c = adminClient();
  const { data, error } = await c.from(TABLE[key]).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`captureState(${key}, ${id}): ${error.message}`);
  return data;
}

export async function captureBeforeState(key: RecordKey, id: string) {
  return captureState(key, id);
}

export async function captureAfterState(key: RecordKey, id: string) {
  return captureState(key, id);
}

export function compareNoMutation(before: unknown, after: unknown): { equal: boolean; diff?: string } {
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  return a === b ? { equal: true } : { equal: false, diff: `before=${a}\nafter=${b}` };
}
