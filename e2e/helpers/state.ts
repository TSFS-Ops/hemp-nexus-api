/**
 * Before/after state capture for wrong-action tests.
 *
 * Uses the service-role key to read an authoritative snapshot of a
 * record so the "no mutation" assertion is real — an RLS-scoped read
 * by a denied user would trivially return nothing.
 *
 * Environments permitted:
 *   - staging  | test       — unrestricted snapshot of any seeded row
 *   - live-demo             — current/production DB, but every record
 *                             read MUST resolve to a row flagged
 *                             is_demo=true (or, for tables without
 *                             is_demo, must carry the rn_seeder marker
 *                             in metadata / reason / notes). This makes
 *                             it safe to run the runtime suite against
 *                             the current build without a separate
 *                             staging stack, while guaranteeing the
 *                             suite cannot touch real client data.
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
  if (env !== "staging" && env !== "test" && env !== "live-demo") {
    throw new Error(
      `state.ts: refuses to run with E2E_RN_ENV=${env}. Must be staging | test | live-demo.`,
    );
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

/** Tables on which we enforce an is_demo=true guard in live-demo mode. */
const DEMO_FLAGGED: Partial<Record<RecordKey, true>> = {
  tradeRequestId: true, matchId: true, poiId: true, wadId: true,
};

function assertDemoSafe(key: RecordKey, row: Record<string, unknown> | null) {
  if (process.env.E2E_RN_ENV !== "live-demo" || row == null) return;
  if (DEMO_FLAGGED[key]) {
    if (row["is_demo"] !== true) {
      throw new Error(
        `state.ts: live-demo refusal — ${TABLE[key]} row ${String(row["id"])} is not is_demo=true. ` +
          `The Role-Negative suite must never touch real client data.`,
      );
    }
    return;
  }
  // match_documents / refund_requests / export_requests / api_keys have
  // no is_demo column; require an RN-seeder fingerprint.
  const fingerprint = JSON.stringify(row).toLowerCase();
  if (!/rn[-_ ]?test|rn_seeder/.test(fingerprint)) {
    throw new Error(
      `state.ts: live-demo refusal — ${TABLE[key]} row ${String(row["id"])} lacks the rn_seeder fingerprint. ` +
        `Refusing to operate on a row that may belong to a real tenant.`,
    );
  }
}

export async function captureState(key: RecordKey, id: string): Promise<unknown> {
  const c = adminClient();
  const { data, error } = await c.from(TABLE[key]).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`captureState(${key}, ${id}): ${error.message}`);
  assertDemoSafe(key, data as Record<string, unknown> | null);
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
