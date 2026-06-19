/**
 * Public API V1 — Batch 5 contract guards.
 *
 * Static source-contract tests for the read-only counterparty lookup
 * and limited summary endpoints. Verifies routing, scope requirements,
 * input validation codes, sandbox isolation, response allowlist mapper,
 * forbidden-field guard, billable semantics, and hard exclusions.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf-8");
const exists = (p: string) => fs.existsSync(path.join(ROOT, p));
const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const ENTRY = "supabase/functions/public-api/index.ts";
const MAPPER = "supabase/functions/_shared/public-api-v1-counterparty.ts";
const GATEWAY = "supabase/functions/_shared/public-api-v1.ts";

describe("Public API V1 · Batch 5 · counterparty lookup + summary", () => {
  it("mapper module exists", () => {
    expect(exists(MAPPER)).toBe(true);
  });

  it("entry dispatches POST /v1/counterparty/lookup with counterparty:lookup scope", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/parts\[0\] === "v1" && parts\[1\] === "counterparty" && parts\[2\] === "lookup"/);
    expect(src).toMatch(/method === "POST"/);
    expect(src).toMatch(/V1_LOOKUP_SCOPE\s*=\s*"counterparty:lookup"/);
    expect(src).toMatch(/handleV1\([^)]*"v1\.counterparty\.lookup"/);
  });

  it("entry dispatches GET /v1/counterparty/{id}/summary with profile:summary_read scope", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/parts\[1\] === "counterparty" && parts\[3\] === "summary"/);
    expect(src).toMatch(/V1_SUMMARY_SCOPE\s*=\s*"profile:summary_read"/);
    expect(src).toMatch(/handleV1\([^)]*"v1\.counterparty\.summary"/);
  });

  it("both endpoints additionally require signals:read for signal-bearing responses", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/V1_SIGNALS_SCOPE\s*=\s*"signals:read"/);
    // Both dispatchers include the signals:read check before doing real work
    const lookupBlock = src.match(/"v1\.counterparty\.lookup"[\s\S]*?\}\);/);
    const summaryBlock = src.match(/"v1\.counterparty\.summary"[\s\S]*?\}\);/);
    expect(lookupBlock).toBeTruthy();
    expect(summaryBlock).toBeTruthy();
    expect(lookupBlock![0]).toMatch(/V1_SIGNALS_SCOPE/);
    expect(summaryBlock![0]).toMatch(/V1_SIGNALS_SCOPE/);
  });

  it("validateLookupInput enforces minimum identifiers, country, and identifier formats", () => {
    const src = read(MAPPER);
    // Minimum: legal_name OR registration_number + country
    expect(src).toMatch(/if \(!norm\.country\) throw new V1Error\("missing_required_field"\)/);
    expect(src).toMatch(/if \(!hasName && !hasReg\) throw new V1Error\("missing_required_field"\)/);
    // Country format → invalid_identifier_format
    expect(src).toMatch(/!\/\^\[A-Z\]\{2\}\$\/.test\(norm\.country\)/);
    expect(src).toMatch(/throw new V1Error\("invalid_identifier_format"\)/);
    // Unsupported country → unsupported_country (ZZ is reserved)
    expect(src).toMatch(/throw new V1Error\("unsupported_country"\)/);
    expect(src).toMatch(/SUPPORTED_COUNTRIES/);
  });

  it("sandbox lookup reads ONLY from api_sandbox_records (no production tables touched)", () => {
    const mapper = read(MAPPER);
    const entry = read(ENTRY);
    // Mapper queries api_sandbox_records and nothing else
    expect(mapper).toMatch(/from\("api_sandbox_records"\)/);
    // Mapper must not touch production-side tables
    for (const tbl of [
      "from(\"organizations\")",
      "from(\"matches\")",
      "from(\"pois\")",
      "from(\"wads\")",
      "from(\"match_documents\")",
      "from(\"governance_doc_registry\")",
      "from(\"governance_documents\")",
      "from(\"vault_documents\")",
      "from(\"entities\")",
      "from(\"trade_requests\")",
    ]) {
      expect(mapper).not.toContain(tbl);
      expect(entry).not.toContain(tbl);
    }
  });

  it("production path is conservative — returns no_match envelope; billable=true only as binding sentinel", () => {
    const src = codeOnly(read(ENTRY));
    // Production lookup branch defaults billable to false and returns buildNoMatchEnvelope
    expect(src).toMatch(/ctx\.billable = false;[\s\S]*?buildNoMatchEnvelope\(ctx\)/);
    // Production summary throws no_match
    expect(src).toMatch(/throw new V1Error\("no_match"\)/);
    // The contract that production successful lookups WILL be billable=true
    // is encoded as a binding sentinel comment for the next batch.
    expect(read(ENTRY)).toMatch(/productionMatchFound[\s\S]*ctx\.billable = true/);
  });

  it("no-match envelope never returns verified=false (no_match ≠ failed verification)", () => {
    const src = read(MAPPER);
    const fn = src.match(/buildNoMatchEnvelope[\s\S]*?return body;\s*\}/);
    expect(fn).toBeTruthy();
    expect(fn![0]).not.toMatch(/verified\s*:\s*false/);
    expect(fn![0]).not.toMatch(/verification_status/);
  });

  it("multi-match envelope is capped at 5 candidates", () => {
    const src = read(MAPPER);
    expect(src).toMatch(/candidatesRaw\.slice\(0,\s*5\)/);
  });

  it("response allowlist + forbidden-field guard is wired", () => {
    const src = read(MAPPER);
    // Allowlists exist
    expect(src).toMatch(/LOOKUP_ALLOWED_FIELDS/);
    expect(src).toMatch(/SUMMARY_ALLOWED_FIELDS/);
    // Forbidden tokens are exhaustive
    for (const tok of [
      "bank","bank_account","iban","swift","document","evidence","governance","audit",
      "internal_note","compliance_note","reviewer_note","personal_id","id_document",
      "poi","wad","payment","private_contact","unapproved_ai","raw_source","other_client",
      "token","secret","key_hash",
    ]) {
      expect(src).toContain(`"${tok}"`);
    }
    // Every envelope builder runs assertNoForbiddenFields before returning
    const builders = src.match(/build(NoMatchEnvelope|MultiMatchEnvelope|LookupEnvelope|SummaryEnvelope)[\s\S]*?return body;\s*\}/g) || [];
    expect(builders.length).toBeGreaterThanOrEqual(4);
    for (const b of builders) {
      expect(b).toMatch(/assertNoForbiddenFields\(body\)/);
    }
  });

  it("sandbox dispatcher maps marker scenarios to V1Errors (provider/internal/rate-limit/unsupported_country)", () => {
    const src = read(MAPPER);
    expect(src).toMatch(/unsupported_country:\s*"unsupported_country"/);
    expect(src).toMatch(/provider_unavailable:\s*"provider_unavailable"/);
    expect(src).toMatch(/internal_error:\s*"internal_error"/);
    expect(src).toMatch(/rate_limit_exceeded:\s*"rate_limit_exceeded"/);
    expect(src).toMatch(/throw new V1Error\(errMapped\)/);
  });

  it("sandbox calls are billable=false; ctx.billable is the single source of truth", () => {
    const entry = codeOnly(read(ENTRY));
    // Both sandbox branches set ctx.billable = false explicitly
    const sandboxAssigns = entry.match(/ctx\.environment === "sandbox"[\s\S]*?ctx\.billable\s*=\s*false/g) || [];
    expect(sandboxAssigns.length).toBeGreaterThanOrEqual(2);

    // Gateway logger reads billable from ctx (Batch 5 wire-up)
    const gw = codeOnly(read(GATEWAY));
    expect(gw).toMatch(/billable:\s*errorCode === null \? ctx\.billable : false/);
    expect(gw).toMatch(/billable:\s*boolean/);
  });

  it("external_reference is accepted from body and propagated to ctx", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/if \(!ctx\.externalReference && input\.external_reference\) \{\s*ctx\.externalReference = input\.external_reference;/);
  });

  it("summary endpoint rejects non-UUID ids with invalid_identifier_format", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/UUID_RE\.test\(id\)/);
    expect(src).toMatch(/throw new V1Error\("invalid_identifier_format"\)/);
  });

  it("summary endpoint never returns marker-only sandbox rows as summaries", () => {
    const src = codeOnly(read(ENTRY));
    expect(src).toMatch(/if \(!row\.legal_name\) throw new V1Error\("no_match"\)/);
  });

  it("entry never imports or transforms existing non-V1 endpoints into V1 output", () => {
    const src = read(ENTRY);
    // No imports from other edge functions or from search/match/poi/wad helpers
    for (const forbidden of [
      "../search/",
      "../discovery/",
      "../match/",
      "../matches/",
      "../poi",
      "../wad",
      "../governance",
      "../evidence",
      "_shared/discovery-engine",
      "_shared/match-lifecycle",
      "_shared/poi-authority",
      "_shared/governance-audit",
      "_shared/evidence-pack-seal",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });

  it("hard exclusions — no Batch-5-forbidden surface introduced", () => {
    // Still no standalone usage/docs/openapi/support edge functions
    expect(exists("supabase/functions/public-api-usage-current")).toBe(false);
    expect(exists("supabase/functions/public-api-docs")).toBe(false);
    expect(exists("supabase/functions/public-api-openapi")).toBe(false);
    expect(exists("supabase/functions/public-api-support-intake")).toBe(false);

    // Entry must not dispatch usage / docs / openapi
    const entry = codeOnly(read(ENTRY));
    expect(entry).not.toMatch(/\/v1\/usage/);
    expect(entry).not.toMatch(/\/v1\/docs/);
    expect(entry).not.toMatch(/openapi/i);

    // No commercial-plan / support-intake / webhook tables introduced
    const migDir = path.join(ROOT, "supabase/migrations");
    for (const f of fs.readdirSync(migDir)) {
      const body = fs.readFileSync(path.join(migDir, f), "utf-8");
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_commercial_plans/i);
      expect(body).not.toMatch(/CREATE TABLE[^;]*api_support_tickets/i);
      // No new webhook tables in any Batch-5-tagged migration
      if (/Batch 5/i.test(body)) {
        expect(body).not.toMatch(/CREATE TABLE[^;]*webhook_/i);
      }
    }
  });
});
