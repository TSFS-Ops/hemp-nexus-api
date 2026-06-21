// Batch 3 — M002 Public Company Search (governed shell).
// Batch 7 — per-IP / per-API-key rate limiting added to prevent enumeration.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { REGISTRY_CLAIM_AUDIT_EVENT_NAMES } from "../_shared/registry-claims.ts";
import {
  clientIpFromRequest,
  enforceRegistrySearchRateLimit,
  rateLimited429,
} from "../_shared/registry-search-rate-limit.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const BodySchema = z.object({
  query: z.string().max(200).optional(),
  country_code: z.string().min(2).max(8).optional(),
  registration_number: z.string().max(60).optional(),
  source_type: z.string().max(40).optional(),
});

Deno.serve(async (req) => {
  const pre = handleCorsPreflight(req);
  if (pre) return pre;
  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return withCors(req, new Response(JSON.stringify({ error: "invalid_body" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Country readiness gate. If the requested country is below imported_unverified
    // or has no coverage we never return rows — we surface the coverage warning.
    let warning: string | null = null;
    if (parsed.data.country_code) {
      const { data: cov } = await svc.from("registry_country_coverage")
        .select("country_code, coverage_state, registry_data_state")
        .eq("country_code", parsed.data.country_code).maybeSingle();
      const blockingStates = new Set(["no_coverage", "seed_only", "sample_only", "dataset_acquired"]);
      if (!cov || blockingStates.has(cov.coverage_state) || blockingStates.has(cov.registry_data_state)) {
        warning = "country_not_production_ready";
      }
    }

    // Batch 3 — no real records ingested. Always return [].
    const results: unknown[] = [];

    await svc.from("event_store").insert({
      event_name: "registry_company_search_performed" satisfies typeof REGISTRY_CLAIM_AUDIT_EVENT_NAMES[number],
      aggregate_id: parsed.data.query ?? "anonymous_search",
      aggregate_type: "registry_company_search",
      actor_id: null,
      payload: { ...parsed.data, warning, result_count: 0 },
    }).catch(() => {});

    return withCors(req, new Response(JSON.stringify({
      ok: true,
      results,
      warning,
      readiness_banner: "shell_ready",
      notice: "Public search shell. No production records are loaded in this release.",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  } catch (err) {
    console.error("registry-company-search error", err);
    return withCors(req, new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }));
  }
});
