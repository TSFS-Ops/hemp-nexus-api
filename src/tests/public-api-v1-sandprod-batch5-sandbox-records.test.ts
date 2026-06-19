/**
 * Public API V1 · Sand/Prod Batch 5 — Sandbox records, deterministic
 * lookup outcomes, and production-protection contract.
 *
 * Static source-contract tests (no Deno imports, no live DB roundtrip):
 * we read the counterparty helper, the gateway, and the Batch 4 seed
 * migration to verify Batch 5 invariants. The six Batch 5 ZA-jurisdiction
 * TEST records were inserted via the data tool, so their live presence
 * is asserted by higher-batch runtime tests; this file pins the contract
 * at the code level.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const COUNTERPARTY = read("supabase/functions/_shared/public-api-v1-counterparty.ts");
const GATEWAY = read("supabase/functions/public-api/index.ts");

// ─── Required ZA sandbox records (Batch 5) ───────────────────────────────

const REQUIRED_ZA_RECORDS = [
  { scenario_code: "za_verified_match", legal_name: "TEST Verified Energy (Pty) Ltd", registration_number: "TEST-2019-000001", match_status: "match" },
  { scenario_code: "za_unverified_match", legal_name: "TEST Unverified Trading Ltd", registration_number: "TEST-2019-000002", match_status: "match" },
  { scenario_code: "za_no_match", legal_name: "TEST No Match Holdings", registration_number: "TEST-NOMATCH", match_status: "no_match" },
  { scenario_code: "za_multiple_possible_matches", legal_name: "TEST Duplicate Supplies Ltd", registration_number: null, match_status: "multiple_matches" },
  { scenario_code: "za_blocked_record", legal_name: "TEST Blocked Entity Ltd", registration_number: "TEST-BLOCKED", match_status: "blocked_record" },
  { scenario_code: "za_stale_record", legal_name: "TEST Stale Agrivoltaics Ltd", registration_number: "TEST-STALE", match_status: "stale_record" },
];

describe("Public API V1 · Sand/Prod Batch 5 · required ZA sandbox records", () => {
  it("every required record has TEST or SANDBOX in its legal name", () => {
    for (const r of REQUIRED_ZA_RECORDS) {
      expect(r.legal_name).toMatch(/TEST|SANDBOX/);
    }
  });

  it("six ZA records cover the required scenarios", () => {
    expect(REQUIRED_ZA_RECORDS.map((r) => r.scenario_code).sort()).toEqual(
      [
        "za_blocked_record",
        "za_multiple_possible_matches",
        "za_no_match",
        "za_stale_record",
        "za_unverified_match",
        "za_verified_match",
      ],
    );
  });

  it("registration numbers are in the documented TEST-* convention", () => {
    const withReg = REQUIRED_ZA_RECORDS.filter((r) => r.registration_number);
    for (const r of withReg) {
      expect(r.registration_number!).toMatch(/^TEST[-A-Z0-9]+$/);
    }
  });
});

// ─── Input aliases + validation contract ─────────────────────────────────

describe("Public API V1 · Sand/Prod Batch 5 · input aliases + validation", () => {
  it("validateLookupInput accepts company_name alias for legal_name", () => {
    expect(COUNTERPARTY).toMatch(/input\.legal_name\s*\?\?\s*input\.company_name/);
  });

  it("validateLookupInput accepts country_code alias for country", () => {
    expect(COUNTERPARTY).toMatch(/input\.country\s*\?\?\s*input\.country_code/);
  });

  it("missing required field still maps to canonical missing_required_field", () => {
    expect(COUNTERPARTY).toMatch(/throw new V1Error\("missing_required_field"\)/);
  });

  it("unsupported country still maps to canonical unsupported_country", () => {
    expect(COUNTERPARTY).toMatch(/throw new V1Error\("unsupported_country"\)/);
  });

  it("country is uppercased (case-insensitive matching)", () => {
    expect(COUNTERPARTY).toMatch(/\.toUpperCase\(\)/);
  });

  it("registration_number / domain comparisons are lowercased (case-insensitive)", () => {
    // resolveSandboxRow compares with .toLowerCase()
    const fn = COUNTERPARTY.match(/export async function resolveSandboxRow[\s\S]*?\n\}/)!;
    expect(fn).not.toBeNull();
    expect(fn![0]).toMatch(/\.toLowerCase\(\)/);
  });
});

// ─── Dispatcher behaviour ────────────────────────────────────────────────

describe("Public API V1 · Sand/Prod Batch 5 · dispatch + envelope contract", () => {
  it("dispatcher branches on row.match_status for no_match", () => {
    expect(COUNTERPARTY).toMatch(/code === "no_match"\s*\|\|\s*ms === "no_match"/);
  });

  it("dispatcher branches on row.match_status for multiple_matches and multiple_possible_matches", () => {
    expect(COUNTERPARTY).toMatch(/ms === "multiple_matches"/);
    expect(COUNTERPARTY).toMatch(/ms === "multiple_possible_matches"/);
  });

  it("no_match envelope never sets verified=false or verification_status=failed", () => {
    const fn = COUNTERPARTY.match(/export function buildNoMatchEnvelope[\s\S]*?\n\}/)!;
    expect(fn).not.toBeNull();
    expect(fn![0]).not.toMatch(/verified:\s*false/);
    expect(fn![0]).not.toMatch(/verification_status:\s*["']failed["']/);
  });

  it("no_match envelope includes a safe next_action", () => {
    const fn = COUNTERPARTY.match(/export function buildNoMatchEnvelope[\s\S]*?\n\}/)!;
    expect(fn![0]).toMatch(/next_action:/);
  });

  it("multi-match envelope caps candidates at 5", () => {
    const fn = COUNTERPARTY.match(/export function buildMultiMatchEnvelope[\s\S]*?\n\}/)!;
    expect(fn![0]).toMatch(/\.slice\(0,\s*5\)/);
  });

  it("blocked envelope nulls risk_signal_summary and sets blocked verification_status", () => {
    const fn = COUNTERPARTY.match(/export function buildLookupEnvelope[\s\S]*?\n\}/)!;
    expect(fn![0]).toMatch(/isBlocked\s*\?\s*null/);
    expect(fn![0]).toMatch(/isBlocked\s*\?\s*"blocked"/);
  });

  it("stale envelope sets verification_status=stale and preserves data_freshness_date", () => {
    const fn = COUNTERPARTY.match(/export function buildLookupEnvelope[\s\S]*?\n\}/)!;
    expect(fn![0]).toMatch(/isStale\s*\?\s*"stale"/);
    expect(fn![0]).toMatch(/data_freshness_date:\s*row\.data_freshness_date/);
  });

  it("lookup envelope carries lookup_status mirror alongside match_status", () => {
    const fn = COUNTERPARTY.match(/export function buildLookupEnvelope[\s\S]*?\n\}/)!;
    expect(fn![0]).toMatch(/lookup_status:\s*ms/);
  });
});

// ─── Sandbox-only response markers ───────────────────────────────────────

describe("Public API V1 · Sand/Prod Batch 5 · sandbox-only markers", () => {
  it("withSandboxMarkers gate fires only in sandbox", () => {
    expect(COUNTERPARTY).toMatch(/if\s*\(ctx\.environment\s*!==\s*"sandbox"\)\s*return\s*body/);
  });

  it("sandbox markers added: test_record=true and sandbox_case_id=row.scenario_code", () => {
    expect(COUNTERPARTY).toMatch(/body\.test_record\s*=\s*true/);
    expect(COUNTERPARTY).toMatch(/body\.sandbox_case_id\s*=\s*row\.scenario_code/);
  });

  it("LOOKUP_ALLOWED_FIELDS includes lookup_status, test_record, sandbox_case_id", () => {
    for (const f of ["lookup_status", "test_record", "sandbox_case_id"]) {
      expect(COUNTERPARTY).toMatch(new RegExp(`"${f}"`));
    }
  });
});

// ─── Production protection ───────────────────────────────────────────────

describe("Public API V1 · Sand/Prod Batch 5 · production protection", () => {
  it("gateway sandbox branch resolves rows via resolveSandboxRow", () => {
    const sandboxBranch = GATEWAY.match(/ctx\.environment === "sandbox"[\s\S]*?return\s*\{\s*body\s*\}/);
    expect(sandboxBranch).not.toBeNull();
    expect(sandboxBranch![0]).toContain("resolveSandboxRow");
    expect(sandboxBranch![0]).toContain("ctx.billable = false");
  });

  it("resolveSandboxRow queries only api_sandbox_records", () => {
    const fn = COUNTERPARTY.match(/export async function resolveSandboxRow[\s\S]*?\n\}/)!;
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain('.from("api_sandbox_records")');
    // Must not touch any production-side tables in this helper.
    expect(fn![0]).not.toMatch(/\.from\("(?!api_sandbox_records)/);
  });

  it("gateway production branch never reads api_sandbox_records", () => {
    const productionBranch = GATEWAY.match(/\/\/ Production path[\s\S]*?return\s*\{\s*body\s*\}/);
    expect(productionBranch).not.toBeNull();
    expect(productionBranch![0]).not.toContain("api_sandbox_records");
    expect(productionBranch![0]).not.toContain("resolveSandboxRow");
  });

  it("production lookup remains conservative (buildNoMatchEnvelope + non-billable)", () => {
    const productionBranch = GATEWAY.match(/\/\/ Production path[\s\S]*?return\s*\{\s*body\s*\}/)!;
    expect(productionBranch![0]).toContain("buildNoMatchEnvelope(ctx)");
    expect(productionBranch![0]).toContain("ctx.billable = false");
  });

  it("Batch 2 schema-separation exception remains live (not retired in Batch 5)", () => {
    // Find the Batch 2 V1 exceptions migration and confirm the exception
    // row is still present and not marked retired by a later migration in
    // this batch.
    const migDir = path.join(ROOT, "supabase/migrations");
    const files = fs.readdirSync(migDir);
    const hasException = files.some((f) =>
      fs.readFileSync(path.join(migDir, f), "utf-8").includes("api_v1_exceptions") &&
      fs.readFileSync(path.join(migDir, f), "utf-8").includes("Sandbox records remain in api_sandbox_records"),
    );
    expect(hasException).toBe(true);
  });
});

// ─── Sandbox call accounting (non-billable, environment-tagged) ──────────

describe("Public API V1 · Sand/Prod Batch 5 · sandbox accounting", () => {
  it("gateway forces ctx.billable=false on every sandbox lookup", () => {
    const sandboxBranch = GATEWAY.match(/ctx\.environment === "sandbox"[\s\S]*?return\s*\{\s*body\s*\}/)!;
    expect(sandboxBranch![0]).toMatch(/ctx\.billable\s*=\s*false/);
  });

  it("request logger captures environment, request_payload_hash and rate_limit_decision", () => {
    const v1 = read("supabase/functions/_shared/public-api-v1.ts");
    expect(v1).toMatch(/environment/);
    expect(v1).toMatch(/request_payload_hash|requestPayloadHash/);
    expect(v1).toMatch(/rate_limit_decision|rateLimitDecision/);
  });
});

// ─── Hard exclusions — Batch 5 must not introduce out-of-scope surfaces ─

describe("Public API V1 · Sand/Prod Batch 5 · hard exclusions", () => {
  it("no webhook dispatcher added to gateway in this batch", () => {
    // Gateway must not start dispatching live webhooks here.
    expect(GATEWAY).not.toMatch(/webhook_deliveries.*insert|dispatchWebhook\(/i);
  });

  it("no usage dashboard mutations added to counterparty helper in this batch", () => {
    expect(COUNTERPARTY).not.toMatch(/usage_dashboard|admin_dashboard/i);
  });
});
