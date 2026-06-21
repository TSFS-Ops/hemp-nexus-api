// Batch 8 — Public registry company search (working).
//
// Returns matching records by querying registry_company_search_index at
// the PUBLIC tier only. RLS enforces the same boundary at the database
// level; this code is defence-in-depth.
//
// Match reason labels are returned ONLY for public-tier matches. If an
// admin-tier match exists for the same query, the result is NOT
// returned to the public caller, and the suppression is audited as
// registry_company_sensitive_match_suppressed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  clientIpFromRequest,
  enforceRegistrySearchRateLimit,
  rateLimited429,
} from "../_shared/registry-search-rate-limit.ts";
import { normaliseSearchValue } from "../_shared/registry-record-model.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  query: z.string().max(200).optional(),
  country_code: z.string().min(2).max(8).optional(),
  registration_number: z.string().max(60).optional(),
  vat_number: z.string().max(60).optional(),
  legal_form: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

interface MatchRow {
  record_id: string;
  field_kind: string;
  field_label: string;
  value_raw: string;
  value_normalised: string;
}

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }),
        { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Rate limit (Batch 7).
    const apiKeyHeader = req.headers.get("x-api-key");
    const rl = await enforceRegistrySearchRateLimit({
      supabase: svc, endpoint: "registry-company-search",
      ip: clientIpFromRequest(req),
      apiKeyId: apiKeyHeader ? apiKeyHeader.slice(0, 64) : null,
    });
    if (!rl.ok) return withCors(req, rateLimited429(rl));

    // Country readiness gate (existing Batch 3 rule).
    let warning: string | null = null;
    if (parsed.data.country_code) {
      const { data: cov } = await svc.from("registry_country_coverage")
        .select("country_code, coverage_state, registry_data_state")
        .eq("country_code", parsed.data.country_code).maybeSingle();
      const blocking = new Set(["no_coverage", "seed_only", "sample_only", "dataset_acquired"]);
      if (!cov || blocking.has(cov.coverage_state) || blocking.has(cov.registry_data_state)) {
        warning = "country_not_production_ready";
      }
    }

    // Collect candidate normalised query tokens.
    const tokens = [
      parsed.data.query,
      parsed.data.registration_number,
      parsed.data.vat_number,
      parsed.data.address,
      parsed.data.legal_form,
    ].filter((x): x is string => !!x && x.trim().length > 0)
     .map(normaliseSearchValue)
     .filter(t => t.length >= 2);

    if (tokens.length === 0) {
      // No usable search input — return empty quickly.
      await svc.from("event_store").insert({
        event_name: "registry_company_public_search_performed",
        aggregate_id: "anonymous_search",
        aggregate_type: "registry_company_search",
        payload: { token_count: 0, warning, result_count: 0 },
      }).catch(() => {});
      return withCors(req, new Response(JSON.stringify({
        ok: true, results: [], warning, readiness_banner: "imported_unverified",
        notice: "Type a company name, number or address to search.",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    const limit = parsed.data.limit ?? 20;

    // PUBLIC-tier matches.
    let publicQuery = svc
      .from("registry_company_search_index")
      .select("record_id, field_kind, field_label, value_raw, value_normalised")
      .eq("tier", "public");
    publicQuery = publicQuery.or(tokens.map(t => `value_normalised.ilike.%${t}%`).join(","));
    const { data: publicMatches } = await publicQuery.limit(200);

    // ADMIN-tier matches (for suppression accounting only; never returned).
    let adminQuery = svc
      .from("registry_company_search_index")
      .select("record_id")
      .eq("tier", "admin");
    adminQuery = adminQuery.or(tokens.map(t => `value_normalised.ilike.%${t}%`).join(","));
    const { data: adminMatches } = await adminQuery.limit(200);

    const publicRecordIds = new Set((publicMatches ?? []).map(r => r.record_id));
    const suppressedRecordIds = (adminMatches ?? [])
      .map(r => r.record_id)
      .filter(id => !publicRecordIds.has(id));

    if (suppressedRecordIds.length > 0) {
      await svc.from("event_store").insert({
        event_name: "registry_company_sensitive_match_suppressed",
        aggregate_id: "anonymous_search",
        aggregate_type: "registry_company_search",
        payload: { suppressed_count: suppressedRecordIds.length, token_count: tokens.length },
      }).catch(() => {});
    }

    // Country-filter the candidate records and hydrate the result cards.
    let recordQuery = svc.from("registry_company_records")
      .select("id, country_code, company_name, registration_number, local_number, vat_number, legal_form, company_status, registered_address, source_summary, source_generated_date, readiness_state, claim_status, claim_allowed, claim_blocked_reason, public_display_allowed")
      .in("id", Array.from(publicRecordIds))
      .eq("public_display_allowed", true);
    if (parsed.data.country_code) {
      recordQuery = recordQuery.eq("country_code", parsed.data.country_code.toUpperCase());
    }
    const { data: records } = await recordQuery.limit(limit);

    // Group match reasons per record.
    const reasonsByRecord = new Map<string, Array<{ field_label: string; value_raw: string }>>();
    for (const m of (publicMatches ?? []) as MatchRow[]) {
      const arr = reasonsByRecord.get(m.record_id) ?? [];
      if (!arr.some(x => x.field_label === m.field_label)) {
        arr.push({ field_label: m.field_label, value_raw: m.value_raw });
      }
      reasonsByRecord.set(m.record_id, arr);
    }

    const results = (records ?? []).map(r => ({
      id: r.id,
      country_code: r.country_code,
      company_name: r.company_name,
      registration_number: r.registration_number,
      local_number: r.local_number,
      vat_number: r.vat_number,
      legal_form: r.legal_form,
      company_status: r.company_status,
      registered_address: r.registered_address,
      source_summary: r.source_summary,
      source_generated_date: r.source_generated_date,
      readiness_label: r.readiness_state,
      claim_status: r.claim_status,
      claim_available: r.claim_allowed === true && !r.claim_blocked_reason,
      claim_blocked_reason: r.claim_blocked_reason,
      match_reasons: reasonsByRecord.get(r.id) ?? [],
      profile_link: `/registry/company/${r.id}`,
    }));

    await svc.from("event_store").insert({
      event_name: "registry_company_public_search_performed",
      aggregate_id: "anonymous_search",
      aggregate_type: "registry_company_search",
      payload: {
        token_count: tokens.length,
        result_count: results.length,
        suppressed_record_count: suppressedRecordIds.length,
        country_code: parsed.data.country_code ?? null,
        warning,
      },
    }).catch(() => {});

    if (results.length === 0) {
      await svc.from("event_store").insert({
        event_name: "registry_company_no_result_new_request_prompted",
        aggregate_id: "anonymous_search",
        aggregate_type: "registry_company_search",
        payload: { token_count: tokens.length },
      }).catch(() => {});
    }

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      results,
      warning,
      readiness_banner: "imported_unverified",
      notice: "Source-backed records. Not independently verified by Izenzo.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-company-search error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
