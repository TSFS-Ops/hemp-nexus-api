/**
 * Public API V1 · Batch 5 — Counterparty lookup + summary helpers.
 *
 * Everything that can possibly leave the V1 surface must flow through
 * this module's allowlist mappers. The mappers are the single point that
 * decides which fields are public-safe; the runtime guard re-checks that
 * NO forbidden field name ever appears in the output (defence in depth).
 *
 * Hard rules enforced here:
 *  - Sandbox lookups read ONLY from public.api_sandbox_records.
 *  - Production lookups never reach into internal Izenzo tables here;
 *    the production path is conservative (no_match) until a safe approved
 *    production source is wired in a later batch.
 *  - No forbidden fields (bank, document, evidence, governance, audit,
 *    internal_note, compliance_note, reviewer_note, personal_id,
 *    id_document, poi, wad, payment, private_contact, unapproved_ai,
 *    raw_source, other_client, token, secret, key_hash) can ever appear
 *    in a successful response — `assertNoForbiddenFields` throws if they
 *    do, which the gateway will surface as a safe internal_error rather
 *    than leaking data.
 *  - The mapper never returns `verified=false` for no_match — no_match is
 *    not failed verification.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { V1Error, type V1RequestCtx } from "./public-api-v1.ts";

// ─── Approved V1 response field allowlists ───────────────────────────────

export const LOOKUP_ALLOWED_FIELDS = [
  "request_id",
  "environment",
  "match_status",
  "lookup_status",
  "confidence_band",
  "verification_status",
  "risk_signal_summary",
  "data_freshness_date",
  "record_scope",
  "next_action",
  "billable",
  "timestamp",
  "external_reference",
  // multi-match envelope additions
  "candidates",
  "match_reason",
  "required_next_identifier",
  // no-match envelope addition
  "message",
  // summary envelope additions
  "record_id",
  "legal_name",
  "trading_name",
  "country",
  "website_domain",
  // sandbox-only markers (never present in production responses)
  "test_record",
  "sandbox_case_id",
] as const;

export const SUMMARY_ALLOWED_FIELDS = [
  "request_id",
  "environment",
  "record_id",
  "legal_name",
  "trading_name",
  "country",
  "website_domain",
  "match_status",
  "lookup_status",
  "confidence_band",
  "verification_status",
  "risk_signal_summary",
  "data_freshness_date",
  "record_scope",
  "next_action",
  "billable",
  "timestamp",
  "external_reference",
  "test_record",
  "sandbox_case_id",
] as const;

// ─── Forbidden field guard ───────────────────────────────────────────────
//
// Substring-style match against the lowercased JSON of the outbound body.
// Any hit aborts the response — better a safe internal_error than a leak.
export const FORBIDDEN_RESPONSE_TOKENS = [
  "bank",
  "bank_account",
  "iban",
  "swift",
  "document",
  "evidence",
  "governance",
  "audit",
  "internal_note",
  "compliance_note",
  "reviewer_note",
  "personal_id",
  "id_document",
  "poi",
  "wad",
  "payment",
  "private_contact",
  "unapproved_ai",
  "raw_source",
  "other_client",
  "token",
  "secret",
  "key_hash",
] as const;

export function assertNoForbiddenFields(body: unknown): void {
  const walk = (node: unknown): void => {
    if (node && typeof node === "object" && !Array.isArray(node)) {
      for (const k of Object.keys(node as Record<string, unknown>)) {
        const lk = k.toLowerCase();
        for (const tok of FORBIDDEN_RESPONSE_TOKENS) {
          if (lk.includes(tok)) {
            throw new V1Error("internal_error");
          }
        }
        walk((node as Record<string, unknown>)[k]);
      }
    } else if (Array.isArray(node)) {
      for (const v of node) walk(v);
    }
  };
  walk(body);
}

// ─── Country + identifier validation ─────────────────────────────────────

// Supported sandbox/production countries — ISO-3166 alpha-2.
// 'ZZ' is reserved test marker (the sandbox unsupported_country scenario).
export const SUPPORTED_COUNTRIES = new Set([
  "GB", "IE", "ZA", "US", "DE", "FR", "NL", "ES", "IT", "PT",
  "BE", "LU", "CH", "AT", "SE", "DK", "NO", "FI",
]);

const REG_NUMBER_RE = /^[A-Za-z0-9\-/.]{3,32}$/;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

export interface LookupInput {
  legal_name?: string | null;
  /** Sandbox / industry alias for legal_name. Normalised into legal_name. */
  company_name?: string | null;
  trading_name?: string | null;
  registration_number?: string | null;
  country?: string | null;
  /** Sandbox / industry alias for country. Normalised into country. */
  country_code?: string | null;
  website_domain?: string | null;
  email_domain?: string | null;
  tax_number?: string | null;
  external_reference?: string | null;
}

/**
 * Throws V1Error on bad input. Returns a normalised copy. Minimum valid
 * request: (legal_name + country) OR (registration_number + country).
 *
 * Aliases accepted: `company_name` → legal_name, `country_code` → country.
 * Matching is case-insensitive (country uppercased, the rest lowered by
 * resolveSandboxRow).
 */
export function validateLookupInput(input: LookupInput): Required<Pick<LookupInput, "country">> & LookupInput {
  const legal = (input.legal_name ?? input.company_name)?.trim() || null;
  const country = (input.country ?? input.country_code)?.trim().toUpperCase() || null;
  const norm: LookupInput = {
    legal_name: legal,
    trading_name: input.trading_name?.trim() || null,
    registration_number: input.registration_number?.trim() || null,
    country,
    website_domain: input.website_domain?.trim().toLowerCase() || null,
    email_domain: input.email_domain?.trim().toLowerCase() || null,
    tax_number: input.tax_number?.trim() || null,
    external_reference: input.external_reference?.trim() || null,
  };

  if (!norm.country) throw new V1Error("missing_required_field");
  if (!/^[A-Z]{2}$/.test(norm.country)) throw new V1Error("invalid_identifier_format");

  const hasName = !!norm.legal_name;
  const hasReg = !!norm.registration_number;
  if (!hasName && !hasReg) throw new V1Error("missing_required_field");

  if (norm.registration_number && !REG_NUMBER_RE.test(norm.registration_number)) {
    throw new V1Error("invalid_identifier_format");
  }
  if (norm.website_domain && !DOMAIN_RE.test(norm.website_domain)) {
    throw new V1Error("invalid_identifier_format");
  }
  if (norm.email_domain && !DOMAIN_RE.test(norm.email_domain)) {
    throw new V1Error("invalid_identifier_format");
  }
  if (norm.legal_name && norm.legal_name.length > 200) {
    throw new V1Error("invalid_identifier_format");
  }

  // Unsupported-country gate — ZZ is reserved for the sandbox marker row.
  if (!SUPPORTED_COUNTRIES.has(norm.country) && norm.country !== "ZZ") {
    throw new V1Error("unsupported_country");
  }

  return norm as Required<Pick<LookupInput, "country">> & LookupInput;
}

// ─── Sandbox matcher (api_sandbox_records only) ──────────────────────────

// Special scenario codes whose match semantics are "throw the matching
// V1Error instead of returning a body". The seeded sandbox rows for these
// scenarios are documented markers, not fake company envelopes.
const ERROR_SCENARIO_MAP: Record<string, "unsupported_country" | "provider_unavailable" | "internal_error" | "rate_limit_exceeded"> = {
  unsupported_country: "unsupported_country",
  provider_unavailable: "provider_unavailable",
  internal_error: "internal_error",
  rate_limit_exceeded: "rate_limit_exceeded",
};

/**
 * Resolve a sandbox row from a normalised lookup input. Match rules,
 * in order:
 *  1. legal_name equals a scenario_code (deterministic trigger).
 *  2. registration_number equals a seed registration_number (case-insensitive).
 *  3. website_domain or email_domain equals a seed domain.
 *  4. legal_name equals a seed legal_name (case-insensitive).
 * Otherwise → no_match.
 */
export async function resolveSandboxRow(
  supabase: SupabaseClient,
  input: LookupInput,
): Promise<{ row: any | null }> {
  const { data: rows, error } = await supabase
    .from("api_sandbox_records")
    .select("*")
    .eq("active", true);
  if (error || !rows) return { row: null };

  const name = (input.legal_name || "").toLowerCase().trim();
  const reg = (input.registration_number || "").toLowerCase().trim();
  const wd = (input.website_domain || "").toLowerCase().trim();
  const ed = (input.email_domain || "").toLowerCase().trim();

  // 1. scenario_code trigger
  if (name) {
    const trig = (rows as any[]).find((r) => r.scenario_code === name);
    if (trig) return { row: trig };
  }
  // 2. registration_number
  if (reg) {
    const r = (rows as any[]).find((row) => (row.registration_number || "").toLowerCase() === reg);
    if (r) return { row: r };
  }
  // 3. domains
  if (wd || ed) {
    const r = (rows as any[]).find((row) =>
      (wd && (row.website_domain || "").toLowerCase() === wd) ||
      (ed && (row.email_domain || "").toLowerCase() === ed)
    );
    if (r) return { row: r };
  }
  // 4. legal_name
  if (name) {
    const r = (rows as any[]).find((row) => (row.legal_name || "").toLowerCase() === name);
    if (r) return { row: r };
  }
  return { row: null };
}

// ─── Response mappers ────────────────────────────────────────────────────

interface BaseEnvelope {
  request_id: string;
  environment: "sandbox" | "production";
  timestamp: string;
  billable: boolean;
  external_reference?: string | null;
}

function base(ctx: V1RequestCtx): BaseEnvelope {
  const out: BaseEnvelope = {
    request_id: ctx.requestId,
    environment: ctx.environment as "sandbox" | "production",
    timestamp: new Date().toISOString(),
    billable: ctx.billable,
  };
  if (ctx.externalReference) out.external_reference = ctx.externalReference;
  return out;
}

function withSandboxMarkers(ctx: V1RequestCtx, body: Record<string, unknown>, row?: any) {
  if (ctx.environment !== "sandbox") return body;
  body.test_record = true;
  if (row && row.scenario_code) body.sandbox_case_id = row.scenario_code;
  return body;
}

export function buildNoMatchEnvelope(ctx: V1RequestCtx, row?: any) {
  // IMPORTANT: never include verification_status="failed" or verified=false
  // here — no_match is NOT failed verification.
  const body: Record<string, unknown> = {
    ...base(ctx),
    match_status: "no_match",
    lookup_status: "no_match",
    confidence_band: "none",
    message: "No matching record found",
    next_action: "Submit additional identifiers or request manual review.",
  };
  withSandboxMarkers(ctx, body, row);
  assertNoForbiddenFields(body);
  return body;
}

export function buildMultiMatchEnvelope(ctx: V1RequestCtx, row: any) {
  const candidatesRaw = Array.isArray(row.candidates) ? row.candidates : [];
  const candidates = candidatesRaw.slice(0, 5).map((c: any) => ({
    id: String(c.id ?? ""),
    legal_name: c.legal_name ?? null,
    registration_number: c.registration_number ?? null,
    country: c.country ?? null,
    confidence_band: c.confidence_band ?? "low",
  }));
  const body: Record<string, unknown> = {
    ...base(ctx),
    match_status: "multiple_possible_matches",
    lookup_status: "multiple_possible_matches",
    candidates,
    match_reason: row.risk_signal_summary || "Multiple candidate records share similar identifiers.",
    confidence_band: row.confidence_band ?? "low",
    required_next_identifier: "registration_number",
    next_action: row.next_action ?? "Disambiguate using registration number or country.",
  };
  withSandboxMarkers(ctx, body, row);
  assertNoForbiddenFields(body);
  return body;
}

export function buildLookupEnvelope(ctx: V1RequestCtx, row: any) {
  const ms = row.match_status ?? "match";
  // For blocked/stale rows, omit reviewer-level detail and never imply
  // current verification.
  const isBlocked = ms === "blocked_record" || ms === "blocked";
  const isStale = ms === "stale_record" || row.verification_status === "stale";
  const body: Record<string, unknown> = {
    ...base(ctx),
    match_status: ms,
    lookup_status: ms,
    confidence_band: row.confidence_band ?? "low",
    verification_status: isStale ? "stale" : (isBlocked ? "blocked" : (row.verification_status ?? "unverified")),
    risk_signal_summary: isBlocked ? null : (row.risk_signal_summary ?? null),
    data_freshness_date: row.data_freshness_date ?? null,
    record_scope: row.record_scope ?? "sandbox_only",
    next_action: row.next_action ?? (isBlocked ? "Manual review required." : null),
  };
  withSandboxMarkers(ctx, body, row);
  assertNoForbiddenFields(body);
  return body;
}

export function buildSummaryEnvelope(ctx: V1RequestCtx, row: any) {
  const body: Record<string, unknown> = {
    ...base(ctx),
    record_id: row.id,
    legal_name: row.legal_name ?? null,
    trading_name: row.trading_name ?? null,
    country: row.country ?? null,
    website_domain: row.website_domain ?? null,
    match_status: row.match_status ?? "match",
    lookup_status: row.match_status ?? "match",
    confidence_band: row.confidence_band ?? "low",
    verification_status: row.verification_status ?? "unverified",
    risk_signal_summary: row.risk_signal_summary ?? null,
    data_freshness_date: row.data_freshness_date ?? null,
    record_scope: row.record_scope ?? "sandbox_only",
    next_action: row.next_action ?? null,
  };
  withSandboxMarkers(ctx, body, row);
  assertNoForbiddenFields(body);
  return body;
}

// ─── Sandbox dispatcher ──────────────────────────────────────────────────

/**
 * Translate a matched sandbox row into the correct V1 envelope or throw
 * the corresponding V1Error for "marker" scenarios.
 */
export function dispatchSandboxRow(ctx: V1RequestCtx, row: any) {
  const code = row.scenario_code as string;
  const ms = row.match_status as string | null;
  // Error-marker scenarios — throw V1Error so the gateway returns the
  // canonical error envelope instead of a success body.
  const errMapped = ERROR_SCENARIO_MAP[code];
  if (errMapped) throw new V1Error(errMapped);

  if (code === "no_match" || ms === "no_match") {
    return buildNoMatchEnvelope(ctx, row);
  }
  if (
    code === "multiple_possible_matches" ||
    ms === "multiple_matches" ||
    ms === "multiple_possible_matches"
  ) {
    return buildMultiMatchEnvelope(ctx, row);
  }
  return buildLookupEnvelope(ctx, row);
}
