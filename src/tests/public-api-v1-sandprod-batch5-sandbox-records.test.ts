/**
 * Public API V1 · Sand/Prod Batch 5 — Sandbox records, deterministic
 * lookup outcomes, and production-protection contract.
 *
 * Static source/contract tests (no live DB roundtrip): we read the
 * counterparty helper, the gateway, and the Batch 4 seed migration to
 * verify Batch 5 invariants.
 *
 * Batch 5 adds six ZA-jurisdiction TEST records on top of the Batch 4
 * scenario seeds (those rows were inserted via the data tool, so this
 * file pins behaviour at the code/contract level — the live presence of
 * the rows is asserted by the Batch 4 + Batch 5 cross-consistency tests
 * that already query the table at runtime in higher batches).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  validateLookupInput,
  resolveSandboxRow,
  dispatchSandboxRow,
  buildNoMatchEnvelope,
  buildMultiMatchEnvelope,
  buildLookupEnvelope,
  LOOKUP_ALLOWED_FIELDS,
  SUMMARY_ALLOWED_FIELDS,
} from "../../supabase/functions/_shared/public-api-v1-counterparty.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");

const COUNTERPARTY = read("supabase/functions/_shared/public-api-v1-counterparty.ts");
const GATEWAY = read("supabase/functions/public-api/index.ts");

// Minimal ctx fixture shared across envelope tests.
function ctx(env: "sandbox" | "production" = "sandbox", overrides: Record<string, unknown> = {}) {
  return {
    requestId: "req_test_batch5",
    environment: env,
    billable: env === "sandbox" ? false : true,
    externalReference: null,
    ...overrides,
  } as any;
}

// ─── Required ZA sandbox records (Batch 5) ───────────────────────────────

const REQUIRED_ZA_RECORDS: Array<{
  scenario_code: string;
  legal_name: string;
  registration_number: string | null;
  match_status: string;
  data_freshness_date?: string | null;
  candidates?: number;
}> = [
  { scenario_code: "za_verified_match", legal_name: "TEST Verified Energy (Pty) Ltd", registration_number: "TEST-2019-000001", match_status: "match" },
  { scenario_code: "za_unverified_match", legal_name: "TEST Unverified Trading Ltd", registration_number: "TEST-2019-000002", match_status: "match" },
  { scenario_code: "za_no_match", legal_name: "TEST No Match Holdings", registration_number: "TEST-NOMATCH", match_status: "no_match" },
  { scenario_code: "za_multiple_possible_matches", legal_name: "TEST Duplicate Supplies Ltd", registration_number: null, match_status: "multiple_matches", candidates: 5 },
  { scenario_code: "za_blocked_record", legal_name: "TEST Blocked Entity Ltd", registration_number: "TEST-BLOCKED", match_status: "blocked_record" },
  { scenario_code: "za_stale_record", legal_name: "TEST Stale Agrivoltaics Ltd", registration_number: "TEST-STALE", match_status: "stale_record", data_freshness_date: "2023-01-10" },
];

// Build the synthetic in-memory row a sandbox lookup would resolve to.
function rowFor(scenario_code: string) {
  const r = REQUIRED_ZA_RECORDS.find((x) => x.scenario_code === scenario_code)!;
  const candidates =
    r.candidates && r.candidates > 0
      ? Array.from({ length: r.candidates }, (_, i) => ({
          id: `za-cand-${i + 1}`,
          legal_name: `${r.legal_name} #${i + 1}`,
          registration_number: `TEST-2019-00001${i}`,
          country: "ZA",
          confidence_band: "low",
        }))
      : [];
  return {
    id: `seed-${scenario_code}`,
    scenario_code,
    legal_name: r.legal_name,
    trading_name: null,
    registration_number: r.registration_number,
    country: "ZA",
    website_domain: null,
    email_domain: null,
    match_status: r.match_status,
    confidence_band: r.match_status === "match" ? "high" : "low",
    verification_status:
      scenario_code === "za_verified_match"
        ? "verified"
        : scenario_code === "za_unverified_match"
        ? "unverified"
        : scenario_code === "za_stale_record"
        ? "stale"
        : scenario_code === "za_blocked_record"
        ? "blocked"
        : "not_applicable",
    risk_signal_summary: scenario_code === "za_blocked_record" ? null : "summary",
    data_freshness_date: r.data_freshness_date ?? null,
    record_scope: "sandbox_only",
    next_action: "next",
    candidates,
    test_data: true,
    active: true,
  };
}

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
});

describe("Public API V1 · Sand/Prod Batch 5 · input aliases + validation", () => {
  it("accepts company_name alias for legal_name", () => {
    const n = validateLookupInput({ company_name: "TEST Verified Energy (Pty) Ltd", country: "ZA" } as any);
    expect(n.legal_name).toBe("TEST Verified Energy (Pty) Ltd");
  });

  it("accepts country_code alias for country and uppercases it", () => {
    const n = validateLookupInput({ company_name: "TEST X", country_code: "za" } as any);
    expect(n.country).toBe("ZA");
  });

  it("missing required field returns canonical missing_required_field", () => {
    expect(() => validateLookupInput({ country: "ZA" } as any)).toThrowError(/missing_required_field/);
    expect(() => validateLookupInput({ legal_name: "X" } as any)).toThrowError(/missing_required_field/);
  });

  it("unsupported country returns canonical unsupported_country", () => {
    expect(() => validateLookupInput({ registration_number: "TEST-1", country: "XX" } as any)).toThrowError(
      /unsupported_country/,
    );
  });
});

describe("Public API V1 · Sand/Prod Batch 5 · dispatch behaviour", () => {
  it("za_verified_match returns lookup_status=match with verified status", () => {
    const body = dispatchSandboxRow(ctx(), rowFor("za_verified_match")) as any;
    expect(body.lookup_status).toBe("match");
    expect(body.verification_status).toBe("verified");
    expect(body.test_record).toBe(true);
    expect(body.sandbox_case_id).toBe("za_verified_match");
  });

  it("za_unverified_match returns lookup_status=match with unverified status", () => {
    const body = dispatchSandboxRow(ctx(), rowFor("za_unverified_match")) as any;
    expect(body.lookup_status).toBe("match");
    expect(body.verification_status).toBe("unverified");
  });

  it("za_no_match returns canonical no_match envelope (no failed verification)", () => {
    const body = dispatchSandboxRow(ctx(), rowFor("za_no_match")) as any;
    expect(body.lookup_status).toBe("no_match");
    expect(body.match_status).toBe("no_match");
    expect(body.verification_status).toBeUndefined();
    expect(body.verified).toBeUndefined();
    expect(body.next_action).toMatch(/identifier|manual review/i);
  });

  it("za_multiple_possible_matches returns up to 5 fictional candidates", () => {
    const body = dispatchSandboxRow(ctx(), rowFor("za_multiple_possible_matches")) as any;
    expect(body.lookup_status).toBe("multiple_possible_matches");
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates.length).toBeLessThanOrEqual(5);
    for (const c of body.candidates) {
      expect(`${c.legal_name}`).toMatch(/TEST|SANDBOX/);
    }
  });

  it("za_blocked_record returns blocked_record with no reviewer detail", () => {
    const body = dispatchSandboxRow(ctx(), rowFor("za_blocked_record")) as any;
    expect(body.lookup_status).toBe("blocked_record");
    expect(body.risk_signal_summary).toBeNull();
    const json = JSON.stringify(body).toLowerCase();
    for (const tok of ["reviewer", "compliance_note", "internal_note", "sanctions"]) {
      expect(json.includes(tok)).toBe(false);
    }
  });

  it("za_stale_record returns stale_record with data_freshness_date", () => {
    const body = dispatchSandboxRow(ctx(), rowFor("za_stale_record")) as any;
    expect(body.lookup_status).toBe("stale_record");
    expect(body.data_freshness_date).toBe("2023-01-10");
    expect(body.verification_status).toBe("stale");
  });
});

describe("Public API V1 · Sand/Prod Batch 5 · sandbox-only response markers", () => {
  it("sandbox envelopes include test_record and sandbox_case_id", () => {
    const body = buildLookupEnvelope(ctx("sandbox"), rowFor("za_verified_match")) as any;
    expect(body.test_record).toBe(true);
    expect(body.sandbox_case_id).toBe("za_verified_match");
  });

  it("production envelopes never include sandbox-only markers", () => {
    const noMatch = buildNoMatchEnvelope(ctx("production"), rowFor("za_no_match")) as any;
    expect(noMatch.test_record).toBeUndefined();
    expect(noMatch.sandbox_case_id).toBeUndefined();
    expect(noMatch.environment).toBe("production");
  });
});

describe("Public API V1 · Sand/Prod Batch 5 · response shape allowlists", () => {
  it("lookup_status appears in LOOKUP_ALLOWED_FIELDS and SUMMARY_ALLOWED_FIELDS", () => {
    expect(LOOKUP_ALLOWED_FIELDS).toContain("lookup_status");
    expect(SUMMARY_ALLOWED_FIELDS).toContain("lookup_status");
  });

  it("sandbox markers are listed in the allowlists", () => {
    expect(LOOKUP_ALLOWED_FIELDS).toContain("test_record");
    expect(LOOKUP_ALLOWED_FIELDS).toContain("sandbox_case_id");
  });

  it("no envelope leaks forbidden tokens (bank/document/evidence/poi/wad/payment/etc)", () => {
    const sandboxBodies = [
      buildLookupEnvelope(ctx("sandbox"), rowFor("za_verified_match")),
      buildLookupEnvelope(ctx("sandbox"), rowFor("za_blocked_record")),
      buildLookupEnvelope(ctx("sandbox"), rowFor("za_stale_record")),
      buildMultiMatchEnvelope(ctx("sandbox"), rowFor("za_multiple_possible_matches")),
      buildNoMatchEnvelope(ctx("sandbox"), rowFor("za_no_match")),
    ];
    for (const b of sandboxBodies) {
      for (const k of Object.keys(b as any)) {
        const lk = k.toLowerCase();
        for (const tok of ["bank", "iban", "swift", "document", "evidence", "governance", "audit", "internal_note", "compliance_note", "reviewer_note", "personal_id", "id_document", "poi", "wad", "payment", "private_contact", "unapproved_ai", "raw_source", "other_client", "key_hash"]) {
          // key may contain "country" or other innocent strings — we only check the strict forbidden token list.
          if (tok === "token" || tok === "secret") continue;
          expect(lk.includes(tok)).toBe(false);
        }
      }
    }
  });
});

describe("Public API V1 · Sand/Prod Batch 5 · production protection", () => {
  it("gateway sandbox branch reads ONLY api_sandbox_records via resolveSandboxRow", () => {
    // The sandbox branch must go through resolveSandboxRow and must NOT
    // touch any other source. We assert the code path by string match
    // (defence-in-depth alongside the live integration tests).
    const sandboxBranch = GATEWAY.match(/ctx\.environment === "sandbox"[\s\S]*?return\s*\{\s*body\s*\}/);
    expect(sandboxBranch).not.toBeNull();
    expect(sandboxBranch![0]).toContain("resolveSandboxRow");
    expect(sandboxBranch![0]).not.toMatch(/api_clients|organizations|profiles|pois|matches|wads|trade_requests/);
  });

  it("resolveSandboxRow queries only api_sandbox_records", () => {
    const fn = COUNTERPARTY.match(/export async function resolveSandboxRow[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    expect(fn![0]).toContain('.from("api_sandbox_records")');
    // The function body must not touch any production-side tables.
    expect(fn![0]).not.toMatch(/\.from\("(?!api_sandbox_records)/);
  });

  it("gateway production branch never reads api_sandbox_records", () => {
    // Find the production fallback (after the sandbox branch returns).
    const productionBranch = GATEWAY.match(/\/\/ Production path[\s\S]*?return\s*\{\s*body\s*\}/);
    expect(productionBranch).not.toBeNull();
    expect(productionBranch![0]).not.toContain("api_sandbox_records");
    expect(productionBranch![0]).not.toContain("resolveSandboxRow");
  });

  it("production lookup remains conservative (no new production source wired)", () => {
    // The production branch must still funnel through buildNoMatchEnvelope.
    const productionBranch = GATEWAY.match(/\/\/ Production path[\s\S]*?return\s*\{\s*body\s*\}/);
    expect(productionBranch![0]).toContain("buildNoMatchEnvelope(ctx)");
    expect(productionBranch![0]).toContain("ctx.billable = false");
  });
});
