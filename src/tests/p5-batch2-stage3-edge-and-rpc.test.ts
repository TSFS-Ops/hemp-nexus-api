/**
 * P-5 Batch 2 — Stage 3 edge response shape + safety tests.
 *
 * The edge function source is parsed as text — we assert that the safe API
 * JSON shape is enforced, that forbidden wording cannot leak, that no raw
 * sensitive columns are selected, and that the provider-live wording guard
 * is applied before responding.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const EDGE_PATH = resolve(__dirname, "../../supabase/functions/p5-batch2-readiness-summary/index.ts");
const PROOF_PATH = resolve(__dirname, "../../supabase/tests/p5_batch2_rpc_proof.sql");
const MIGRATION_GLOB_DIR = resolve(__dirname, "../../supabase/migrations");

const REQUIRED_FIELDS = [
  "record_id","record_type","linked_entity_id","linked_transaction_id",
  "kyb_status","kyc_status","evidence_status","evidence_rating",
  "readiness_impact","missing_items","blocker_count","warning_count",
  "expiry_warning","expires_at","provider_dependency","provider_status",
  "provider_live","provider_result_reference","reason_code","visible_reason",
  "next_action","last_updated_at","audit_reference","evidence_pack_id","pack_status",
];

describe("p5-batch2 Stage 3 — edge function shape & safety", () => {
  const src = readFileSync(EDGE_PATH, "utf8");

  it("emits every required field in the safe API JSON", () => {
    for (const field of REQUIRED_FIELDS) {
      expect(src, `missing field: ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it("never selects raw sensitive columns", () => {
    for (const banned of [
      "reviewer_note_internal",
      "notes_internal",
      "provider_raw_response",
      "fraud_flag",
      "passport_number",
      "id_number",
      "bank_account_number",
      "tax_number",
    ]) {
      expect(src.toLowerCase(), `edge must not select ${banned}`).not.toContain(banned.toLowerCase());
    }
  });

  it("applies provider wording guard before responding", () => {
    expect(src).toMatch(/wording_guard_blocked/);
    expect(src).toMatch(/FORBIDDEN_WORDING/);
    expect(src).toMatch(/wordingSafe\(/);
  });

  it("forces non-privileged callers down from admin viewer", () => {
    expect(src).toMatch(/PRIVILEGED_ROLES/);
    expect(src).toMatch(/effectiveViewer/);
  });

  it("uses auth.getClaims and rejects unauthenticated requests", () => {
    expect(src).toMatch(/getClaims/);
    expect(src).toMatch(/401/);
  });

  it("rewrites suspected_fraud_or_tampering to a safe externalised label for non-admin viewers", () => {
    expect(src).toMatch(/suspected_fraud_or_tampering/);
    expect(src).toMatch(/Manual review required/);
  });
});

describe("p5-batch2 Stage 3 — SQL proof presence", () => {
  it("ships the RPC proof file and rolls back", () => {
    expect(existsSync(PROOF_PATH)).toBe(true);
    const sql = readFileSync(PROOF_PATH, "utf8");
    expect(sql).toMatch(/BEGIN;/);
    expect(sql).toMatch(/ROLLBACK;/);
    expect(sql).toMatch(/P5B2_STAGE3_PROOF_OK/);
    // exercises every required RPC
    for (const rpc of [
      "p5b2_create_kyc_record",
      "p5b2_link_records",
      "p5b2_generate_checklist",
      "p5b2_upload_evidence_version",
      "p5b2_review_evidence",
      "p5b2_set_provider_state",
      "p5b2_waive_evidence",
      "p5b2_withdraw_evidence",
      "p5b2_suspend_release",
      "p5b2_snapshot_finality_pack",
      "p5b2_log_sensitive_access",
    ]) {
      expect(sql, `proof must exercise ${rpc}`).toContain(rpc);
    }
    // proves provider-live-without-result is blocked, and append-only
    expect(sql).toMatch(/provider_live=true with NULL reference should have been blocked/);
    expect(sql).toMatch(/append-only/);
  });
});

describe("p5-batch2 Stage 3 — migration RPC contract", () => {
  it("Stage 3 migration defines all RPCs as SECURITY DEFINER + SET search_path", () => {
    // Pull in any migration file that defines p5b2_create_kyc_record
    const fs = require("node:fs") as typeof import("node:fs");
    const files = fs.readdirSync(MIGRATION_GLOB_DIR).filter(f => f.endsWith(".sql"));
    const hit = files.map(f => readFileSync(resolve(MIGRATION_GLOB_DIR, f), "utf8"))
      .find(s => s.includes("CREATE OR REPLACE FUNCTION public.p5b2_create_kyc_record"));
    expect(hit, "Stage 3 RPC migration not found").toBeTruthy();
    const sql = hit as string;
    for (const fn of [
      "p5b2_create_kyc_record","p5b2_link_records","p5b2_generate_checklist",
      "p5b2_upload_evidence_version","p5b2_review_evidence","p5b2_set_provider_state",
      "p5b2_waive_evidence","p5b2_withdraw_evidence","p5b2_suspend_release",
      "p5b2_snapshot_finality_pack","p5b2_log_sensitive_access",
    ]) {
      const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public`);
      expect(sql, `${fn} must be SECURITY DEFINER with search_path=public`).toMatch(re);
    }
    // reject/request_correction must require a fixed reason code
    expect(sql).toMatch(/reason_code required for/);
    // upload must require replacement_reason when replacing
    expect(sql).toMatch(/replacement_reason required when replacing existing evidence/);
    // provider_live=true must require a reference
    expect(sql).toMatch(/provider_live=true requires provider_result_reference/);
    // funder / api_customer roles are never in the privileged action lists
    const accept = sql.split("p5b2_review_evidence")[1] ?? "";
    expect(accept.toLowerCase()).not.toMatch(/'funder'|'api_customer'/);
  });
});
