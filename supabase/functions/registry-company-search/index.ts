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
//
// Follow-up additions:
//   • Short-lived per-scope in-process cache (30s TTL).
//   • Additional filters: readiness_state, claim_status (public-safe).
//   • Cursor-based pagination preserving match-reason consistency.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import {
  clientIpFromRequest,
  enforceRegistrySearchRateLimit,
  rateLimited429,
  REGISTRY_SEARCH_LIMITS,
} from "../_shared/registry-search-rate-limit.ts";
import { normaliseSearchValue } from "../_shared/registry-record-model.ts";
import { buildCacheKey, getCached, setCached } from "../_shared/registry-search-cache.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  query: z.string().max(200).optional(),
  country_code: z.string().min(2).max(8).optional(),
  registration_number: z.string().max(60).optional(),
  vat_number: z.string().max(60).optional(),
  legal_form: z.string().max(40).optional(),
  address: z.string().max(200).optional(),
  // New filters (public-safe equality on indexed columns).
  readiness_state: z.string().max(40).optional(),
  claim_status: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  // Opaque cursor — base64 JSON { last_id: uuid }.
  cursor: z.string().max(200).optional(),
});

interface MatchRow {
  record_id: string;
  field_kind: string;
  field_label: string;
  value_raw: string;
  value_normalised: string;
}

function decodeCursor(cursor: string | undefined): { last_id?: string } {
  if (!cursor) return {};
  try {
    const json = JSON.parse(atob(cursor));
    if (json && typeof json.last_id === "string") return { last_id: json.last_id };
  } catch { /* ignore */ }
  return {};
}

function encodeCursor(lastId: string): string {
  return btoa(JSON.stringify({ last_id: lastId }));
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
    const ipAddr = clientIpFromRequest(req);
    const rl = await enforceRegistrySearchRateLimit({
      supabase: svc, endpoint: "registry-company-search",
      ip: ipAddr,
      apiKeyId: apiKeyHeader ? apiKeyHeader.slice(0, 64) : null,
    });
    if (!rl.ok) return withCors(req, rateLimited429(rl));

    // Short-lived per-scope cache. Rate limit still charged above, so the
    // cache cannot be used to bypass enumeration ceilings.
    const cacheKey = buildCacheKey({
      scopeKind: rl.scopeKind,
      scopeKey: rl.scopeKey,
      endpoint: "registry-company-search",
      payload: parsed.data,
    });
    const cached = getCached(cacheKey);
    if (cached) {
      return withCors(req, new Response(cached, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Cache": "HIT" },
      }));
    }

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

    const limit = parsed.data.limit ?? 20;
    const cursor = decodeCursor(parsed.data.cursor);

    const noTokens = tokens.length === 0;
    const filtersOnly =
      noTokens &&
      (parsed.data.country_code || parsed.data.readiness_state || parsed.data.claim_status);

    if (noTokens && !filtersOnly) {
      const emptyBody = JSON.stringify({
        ok: true, results: [], warning, readiness_banner: "imported_unverified",
        notice: "Type a company name, number or address to search.",
        next_cursor: null,
      });
      await svc.from("event_store").insert({
        event_name: "registry_company_public_search_performed",
        aggregate_id: "anonymous_search",
        aggregate_type: "registry_company_search",
        payload: { token_count: 0, warning, result_count: 0 },
      }).catch(() => {});
      setCached(cacheKey, emptyBody);
      return withCors(req, new Response(emptyBody, {
        status: 200, headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
      }));
    }

    // PUBLIC-tier matches (token search).
    let publicMatches: MatchRow[] = [];
    let adminMatchIds: string[] = [];
    if (!noTokens) {
      const pq = svc
        .from("registry_company_search_index")
        .select("record_id, field_kind, field_label, value_raw, value_normalised")
        .eq("tier", "public")
        .or(tokens.map(t => `value_normalised.ilike.%${t}%`).join(","))
        .limit(400);
      const aq = svc
        .from("registry_company_search_index")
        .select("record_id")
        .eq("tier", "admin")
        .or(tokens.map(t => `value_normalised.ilike.%${t}%`).join(","))
        .limit(400);
      const [pubRes, admRes] = await Promise.all([pq, aq]);
      publicMatches = (pubRes.data ?? []) as MatchRow[];
      adminMatchIds = (admRes.data ?? []).map((r: { record_id: string }) => r.record_id);
    }

    const publicRecordIds = noTokens
      ? null
      : Array.from(new Set(publicMatches.map(r => r.record_id))).sort();
    const suppressedRecordIds = noTokens
      ? []
      : adminMatchIds.filter(id => !new Set(publicRecordIds!).has(id));

    if (suppressedRecordIds.length > 0) {
      await svc.from("event_store").insert({
        event_name: "registry_company_sensitive_match_suppressed",
        aggregate_id: "anonymous_search",
        aggregate_type: "registry_company_search",
        payload: { suppressed_count: suppressedRecordIds.length, token_count: tokens.length },
      }).catch(() => {});
    }

    // Build the record-level query with deterministic order (id) so that
    // cursor pagination yields stable, non-overlapping pages and match
    // reasons remain consistent for the records returned on each page.
    let recordQuery = svc.from("registry_company_records")
      .select("id, country_code, company_name, registration_number, local_number, vat_number, legal_form, company_status, registered_address, source_summary, source_generated_date, readiness_state, claim_status, claim_allowed, claim_blocked_reason, public_display_allowed")
      .eq("public_display_allowed", true)
      .order("id", { ascending: true });
    if (publicRecordIds !== null) recordQuery = recordQuery.in("id", publicRecordIds);
    if (parsed.data.country_code)   recordQuery = recordQuery.eq("country_code", parsed.data.country_code.toUpperCase());
    if (parsed.data.legal_form)     recordQuery = recordQuery.eq("legal_form", parsed.data.legal_form);
    if (parsed.data.readiness_state) recordQuery = recordQuery.eq("readiness_state", parsed.data.readiness_state);
    if (parsed.data.claim_status)   recordQuery = recordQuery.eq("claim_status", parsed.data.claim_status);
    if (cursor.last_id)             recordQuery = recordQuery.gt("id", cursor.last_id);
    // Fetch limit+1 to derive next_cursor without re-querying.
    const { data: records } = await recordQuery.limit(limit + 1);

    const pageRecords = (records ?? []).slice(0, limit);
    const hasMore = (records ?? []).length > limit;
    const nextCursor = hasMore && pageRecords.length > 0
      ? encodeCursor(pageRecords[pageRecords.length - 1].id)
      : null;

    // Group match reasons per record (stable per record_id so consistent
    // across pages for the same query).
    const reasonsByRecord = new Map<string, Array<{ field_label: string; value_raw: string }>>();
    for (const m of publicMatches) {
      const arr = reasonsByRecord.get(m.record_id) ?? [];
      if (!arr.some(x => x.field_label === m.field_label)) {
        arr.push({ field_label: m.field_label, value_raw: m.value_raw });
      }
      reasonsByRecord.set(m.record_id, arr);
    }

    const results = pageRecords.map(r => ({
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
        readiness_state: parsed.data.readiness_state ?? null,
        claim_status_filter: parsed.data.claim_status ?? null,
        paged: !!cursor.last_id,
        has_more: hasMore,
        warning,
      },
    }).catch(() => {});

    if (results.length === 0 && !cursor.last_id) {
      await svc.from("event_store").insert({
        event_name: "registry_company_no_result_new_request_prompted",
        aggregate_id: "anonymous_search",
        aggregate_type: "registry_company_search",
        payload: { token_count: tokens.length },
      }).catch(() => {});
    }

    const body = JSON.stringify({
      ok: true,
      results,
      warning,
      readiness_banner: "imported_unverified",
      notice: "Source-backed records. Not independently verified by Izenzo.",
      next_cursor: nextCursor,
      page_size: limit,
      rate_limit: {
        scope_kind: rl.scopeKind,
        per_minute: REGISTRY_SEARCH_LIMITS[rl.scopeKind].perMinute,
        per_hour:   REGISTRY_SEARCH_LIMITS[rl.scopeKind].perHour,
      },
    });
    setCached(cacheKey, body);
    return withCors(req, new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Cache": "MISS" },
    }));
  } catch (err) {
    console.error("registry-company-search error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
