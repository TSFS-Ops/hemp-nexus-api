import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://esm.sh/zod@3.23.8";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { isBypassEnabled, recordBypassUsage } from "../_shared/test-mode-bypass.ts";
import { fetchWithTimeout, ProviderTimeoutError, isProviderFailureStatus } from "../_shared/fetch-with-timeout.ts";
import { checkProviderCooldown, recordProviderFailure, cooldownResponseEnvelope } from "../_shared/provider-retry.ts";

/** Batch F: typed error for provider-down / malformed paths. */
class ScreeningProviderError extends Error {
  constructor(public readonly provider: string, public readonly statusCode: number | null, public readonly reason: string) {
    super(`${provider} provider_error: ${reason}`);
  }
}

// Batch F: Dilisense response schema (loose — only fields we use are required).
const DilisenseRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  source_type: z.string(),
  pep_type: z.string().nullable().optional(),
  source_id: z.string().optional().default(""),
  entity_type: z.string().optional().default(""),
  alias_names: z.array(z.string()).optional(),
  date_of_birth: z.array(z.string()).optional(),
  citizenship: z.array(z.string()).optional(),
  sanction_details: z.array(z.string()).optional(),
  description: z.array(z.string()).optional(),
  positions: z.array(z.string()).optional(),
}).passthrough();

const DilisenseResponseSchema = z.object({
  timestamp: z.string(),
  total_hits: z.number(),
  found_records: z.array(DilisenseRecordSchema),
});

/**
 * Configurable AML/Sanctions/PEP Screening Edge Function
 *
 * Supports multiple providers via admin_settings key "screening_provider":
 *   - "dilisense" (default) - real Dilisense API
 *   - "dow_jones" - stub ready for Dow Jones Factiva integration
 *   - "refinitiv" - stub ready for LSEG World-Check integration
 *   - "stub" - returns clear for dev/test environments
 *
 * POST body:
 *   { org_id, screen_type: "individual"|"entity", name, fuzzy_search?: 1|2, dob?: string, gender?: string, entity_id?: uuid }
 */

const DILISENSE_BASE = "https://api.dilisense.com/v1";

interface DilisenseRecord {
  id: string;
  name: string;
  source_type: string;
  pep_type?: string;
  source_id: string;
  entity_type: string;
  alias_names?: string[];
  date_of_birth?: string[];
  citizenship?: string[];
  sanction_details?: string[];
  description?: string[];
  positions?: string[];
  [key: string]: unknown;
}

interface DilisenseResponse {
  timestamp: string;
  total_hits: number;
  found_records: DilisenseRecord[];
}

interface ScreeningResult {
  provider: string;
  timestamp: string;
  total_hits: number;
  overall_status: "match" | "review" | "clear";
  has_sanction_hit: boolean;
  has_pep_hit: boolean;
  confirmed_matches: number;
  potential_matches: number;
  classified_records: ClassifiedRecord[];
  response_hash: string;
  raw_response?: unknown;
}

interface ClassifiedRecord {
  dilisense_id?: string;
  provider_id?: string;
  name: string;
  source_type: string;
  pep_type: string | null;
  source_id?: string;
  match_level: "confirmed" | "potential" | "no_match";
  alias_names: string[];
  date_of_birth: string[];
  citizenship: string[];
  sanction_details: string[];
  positions: string[];
  description: string[];
}

function classifyMatch(name: string, searchName: string, aliases: string[] = []): "confirmed" | "potential" | "no_match" {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const normSearch = norm(searchName);
  const normName = norm(name || "");

  if (normName === normSearch) return "confirmed";
  if (aliases.map(norm).includes(normSearch)) return "confirmed";

  const bigrams = (s: string) => {
    const b = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) b.add(s.slice(i, i + 2));
    return b;
  };
  const a = bigrams(normSearch);
  const b = bigrams(normName);
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  const similarity = union.size > 0 ? intersection.size / union.size : 0;

  if (similarity >= 0.92) return "potential";
  return "no_match";
}

async function computeHash(data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Provider: Dilisense ──
async function screenWithDilisense(
  name: string, screenType: string, fuzzySearch?: number, dob?: string, gender?: string
): Promise<ScreeningResult> {
  const dilisenseKey = Deno.env.get("DILISENSE_API_KEY");
  if (!dilisenseKey) {
    throw new ApiException("CONFIGURATION_ERROR", "Dilisense API key not configured. Set DILISENSE_API_KEY secret.", 500);
  }

  const endpoint = screenType === "entity" ? "checkEntity" : "checkIndividual";
  const params = new URLSearchParams();
  params.set("names", name);
  if (fuzzySearch) params.set("fuzzy_search", String(fuzzySearch));
  if (dob) params.set("dob", dob);
  if (gender) params.set("gender", gender);

  // Batch F: bounded timeout + provider-error mapping (timeout/5xx/429/malformed).
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "dilisense",
      `${DILISENSE_BASE}/${endpoint}?${params.toString()}`,
      { method: "GET", headers: { "x-api-key": dilisenseKey } },
      10_000,
    );
  } catch (err) {
    if (err instanceof ProviderTimeoutError) {
      throw new ScreeningProviderError("dilisense", 504, "timeout");
    }
    throw new ScreeningProviderError("dilisense", null, (err as Error).message);
  }

  if (!res.ok) {
    const errText = await res.text();
    console.error(`Dilisense API error [${res.status}]:`, errText);
    if (isProviderFailureStatus(res.status)) {
      throw new ScreeningProviderError("dilisense", res.status, `upstream_${res.status}`);
    }
    throw new ApiException("PROVIDER_ERROR", `Screening provider returned ${res.status}`, 502, { providerStatus: res.status });
  }

  const rawData = await res.json().catch(() => null);
  const parsed = DilisenseResponseSchema.safeParse(rawData);
  if (!parsed.success) {
    throw new ScreeningProviderError("dilisense", res.status, `malformed_response: ${parsed.error.message.slice(0, 200)}`);
  }
  const data = parsed.data;
  const responseHash = await computeHash(JSON.stringify(data));

  const classifiedRecords: ClassifiedRecord[] = data.found_records.map((record) => ({
    dilisense_id: record.id,
    provider_id: record.id,
    name: record.name,
    source_type: record.source_type,
    pep_type: record.pep_type || null,
    source_id: record.source_id,
    match_level: classifyMatch(record.name, name, record.alias_names),
    alias_names: record.alias_names || [],
    date_of_birth: record.date_of_birth || [],
    citizenship: record.citizenship || [],
    sanction_details: record.sanction_details || [],
    positions: record.positions || [],
    description: record.description || [],
  }));

  const confirmed = classifiedRecords.filter(r => r.match_level === "confirmed");
  const potential = classifiedRecords.filter(r => r.match_level === "potential");
  const hasSanction = confirmed.some(r => r.source_type === "SANCTION");
  const hasPep = classifiedRecords.some(r => r.source_type === "PEP" && r.match_level !== "no_match");

  let overallStatus: "match" | "review" | "clear";
  if (hasSanction) overallStatus = "match";
  else if (confirmed.length > 0 || potential.length > 0) overallStatus = "review";
  else overallStatus = "clear";

  return {
    provider: "dilisense",
    timestamp: data.timestamp,
    total_hits: data.total_hits,
    overall_status: overallStatus,
    has_sanction_hit: hasSanction,
    has_pep_hit: hasPep,
    confirmed_matches: confirmed.length,
    potential_matches: potential.length,
    classified_records: classifiedRecords.filter(r => r.match_level !== "no_match"),
    response_hash: responseHash,
    raw_response: data,
  };
}

// ── Provider: Dow Jones (stub - ready for real integration) ──
async function screenWithDowJones(
  name: string, screenType: string, _fuzzySearch?: number, _dob?: string, _gender?: string
): Promise<ScreeningResult> {
  const apiKey = Deno.env.get("DOW_JONES_API_KEY");
  if (!apiKey) {
    throw new ApiException(
      "CONFIGURATION_ERROR",
      "Dow Jones API key not configured. Set DOW_JONES_API_KEY secret to enable real screening.",
      500,
      { provider: "dow_jones", setup_required: true }
    );
  }

  // TODO: Replace with real Dow Jones Factiva / Risk & Compliance API call
  // Documentation: https://developer.dowjones.com/site/docs/risk_and_compliance_apis
  // Endpoint: POST https://api.dowjones.com/risk/screening/profiles
  // Headers: Authorization: Bearer {token}
  // Body: { name, type: screenType, ... }
  throw new ApiException(
    "PROVIDER_NOT_IMPLEMENTED",
    "Dow Jones integration requires implementation. API key is configured - add the API call logic to complete setup.",
    501,
    { provider: "dow_jones", api_key_configured: true }
  );
}

// ── Provider: Refinitiv / LSEG World-Check (stub) ──
async function screenWithRefinitiv(
  name: string, screenType: string, _fuzzySearch?: number, _dob?: string, _gender?: string
): Promise<ScreeningResult> {
  const apiKey = Deno.env.get("REFINITIV_API_KEY");
  if (!apiKey) {
    throw new ApiException(
      "CONFIGURATION_ERROR",
      "Refinitiv API key not configured. Set REFINITIV_API_KEY secret to enable real screening.",
      500,
      { provider: "refinitiv", setup_required: true }
    );
  }

  // TODO: Replace with real LSEG World-Check One API call
  // Documentation: https://developers.lseg.com/en/api-catalog/world-check-one
  // Endpoint: POST https://rms-world-check-one-api-pilot.thomsonreuters.com/v2/cases/screeningRequest
  throw new ApiException(
    "PROVIDER_NOT_IMPLEMENTED",
    "Refinitiv World-Check integration requires implementation. API key is configured - add the API call logic to complete setup.",
    501,
    { provider: "refinitiv", api_key_configured: true }
  );
}

// ── Provider: Stub (dev/test - always returns clear) ──
async function screenWithStub(
  name: string, screenType: string
): Promise<ScreeningResult> {
  const responseHash = await computeHash(JSON.stringify({ stub: true, name, screenType, ts: new Date().toISOString() }));
  return {
    provider: "stub",
    timestamp: new Date().toISOString(),
    total_hits: 0,
    overall_status: "clear",
    has_sanction_hit: false,
    has_pep_hit: false,
    confirmed_matches: 0,
    potential_matches: 0,
    classified_records: [],
    response_hash: responseHash,
  };
}

const PROVIDERS: Record<string, typeof screenWithDilisense> = {
  dilisense: screenWithDilisense,
  dow_jones: screenWithDowJones,
  refinitiv: screenWithRefinitiv,
  stub: screenWithStub,
};

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    if (authCtx.isApiKey) requireScope(authCtx, "screening");

    const { actorUserId } = deriveActorIds(authCtx);
    const adminClient = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { org_id, screen_type, name, fuzzy_search, dob, gender, entity_id } = body;

    if (!org_id || !name) {
      throw new ApiException("VALIDATION_ERROR", "org_id and name are required", 400);
    }

    const type = screen_type === "entity" ? "entity" : "individual";

    // ── Test-mode bypass: synthesize a "clear" screening result without touching any provider ──
    if (await isBypassEnabled(adminClient, "sanctions", "dilisense-screen")) {
      const bypassedAt = new Date().toISOString();
      const bypassHash = await computeHash(JSON.stringify({ bypass: true, name, type, ts: bypassedAt }));
      const bypassRecord = {
        org_id,
        screening_type: "sanctions_pep",
        status: "clear",
        matched_entities: [],
        raw_response: { bypass: true, reason: "test_mode_bypass" },
        screened_at: bypassedAt,
        screened_by: actorUserId || null,
        next_screening_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        provider: "test_mode_bypass",
        provider_config: { screen_type: type, bypass: true },
        response_hash: bypassHash,
        entity_id: entity_id || null,
        // Batch I Fix 1: stamp bypass at the data layer so a bypassed "clear"
        // is distinguishable from a real provider clear without joining audit_logs.
        metadata: {
          bypass: true,
          bypass_gate: "sanctions",
          test_mode: true,
          bypass_used_at: bypassedAt,
          bypass_actor: actorUserId || null,
        },
      };

      const { data: savedBypass } = await adminClient
        .from("screening_results")
        .insert(bypassRecord)
        .select()
        .single();

      await recordBypassUsage(adminClient, {
        gate: "sanctions",
        source: "dilisense-screen",
        orgId: org_id,
        actorUserId: actorUserId || null,
        details: {
          screen_type: type,
          name_screened: name,
          entity_id: entity_id || null,
          screening_id: savedBypass?.id || null,
        },
      });

      return new Response(
        JSON.stringify({
          success: true,
          bypass: true,
          bypass_reason: "Test-mode bypass active — sanctions/PEP screening skipped.",
          provider: "test_mode_bypass",
          screening_id: savedBypass?.id || null,
          timestamp: bypassRecord.screened_at,
          total_hits: 0,
          overall_status: "clear",
          has_sanction_hit: false,
          has_pep_hit: false,
          confirmed_matches: 0,
          potential_matches: 0,
          classified_records: [],
          response_hash: bypassHash,
          next_screening_due: bypassRecord.next_screening_at,
        }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── Resolve provider from admin_settings ──
    const { data: providerSetting } = await adminClient
      .from("admin_settings")
      .select("value")
      .eq("key", "screening_provider")
      .maybeSingle();

    const providerName = (providerSetting?.value as any)?.provider || "dilisense";
    const screenFn = PROVIDERS[providerName];
    if (!screenFn) {
      throw new ApiException("CONFIGURATION_ERROR", `Unknown screening provider: ${providerName}. Valid: ${Object.keys(PROVIDERS).join(", ")}`, 500);
    }

    console.log(`[${requestId}] Screening via provider: ${providerName}`);

    // ── Execute screening ──
    let result;
    try {
      result = await screenFn(name, type, fuzzy_search, dob, gender);
    } catch (err) {
      if (err instanceof ScreeningProviderError) {
        // Batch F: persist provider_error so the failure is visible later, not just a toast.
        const errHash = await computeHash(JSON.stringify({ provider_error: true, provider: err.provider, reason: err.reason, ts: new Date().toISOString() }));
        const { data: savedErr } = await adminClient
          .from("screening_results")
          .insert({
            org_id,
            screening_type: "sanctions_pep",
            status: "provider_error",
            matched_entities: [],
            raw_response: { provider_error: true, provider: err.provider, status_code: err.statusCode, reason: err.reason },
            screened_at: new Date().toISOString(),
            screened_by: actorUserId || null,
            next_screening_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            provider: providerName,
            provider_config: { screen_type: type, fuzzy_search: fuzzy_search || null, provider_error: true },
            response_hash: errHash,
            entity_id: entity_id || null,
          })
          .select()
          .single();

        await adminClient.from("audit_logs").insert({
          org_id,
          actor_user_id: actorUserId || null,
          action: "screening.provider_error",
          entity_type: "screening_results",
          entity_id: savedErr?.id || null,
          metadata: {
            provider: err.provider,
            status_code: err.statusCode,
            reason: err.reason,
            request_id: requestId,
            name_screened: name,
            entity_id: entity_id || null,
          },
        });

        return new Response(
          JSON.stringify({
            success: false,
            error: "PROVIDER_ERROR",
            provider: err.provider,
            reason: err.reason,
            status_code: err.statusCode,
            screening_id: savedErr?.id || null,
            message: "The sanctions/PEP provider is currently unavailable. The failure has been recorded and is visible to admins.",
            requestId,
          }),
          { status: 502, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }
      throw err;
    }

    // ── Store screening result ──
    const screeningRecord = {
      org_id,
      screening_type: "sanctions_pep",
      status: result.overall_status,
      matched_entities: result.classified_records,
      raw_response: result.raw_response || null,
      screened_at: new Date().toISOString(),
      screened_by: actorUserId || null,
      next_screening_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      provider: providerName,
      provider_config: { screen_type: type, fuzzy_search: fuzzy_search || null },
      response_hash: result.response_hash,
      entity_id: entity_id || null,
    };

    const { data: savedResult, error: saveErr } = await adminClient
      .from("screening_results")
      .insert(screeningRecord)
      .select()
      .single();

    if (saveErr) {
      console.error("Failed to save screening result:", saveErr);
    }

    // ── Audit log ──
    await adminClient.from("audit_logs").insert({
      org_id,
      actor_user_id: actorUserId || null,
      action: `screening.${type}.completed`,
      entity_type: "screening_results",
      entity_id: savedResult?.id || null,
      metadata: {
        provider: providerName,
        name_screened: name,
        entity_id: entity_id || null,
        total_hits: result.total_hits,
        confirmed_matches: result.confirmed_matches,
        potential_matches: result.potential_matches,
        overall_status: result.overall_status,
        response_hash: result.response_hash,
        request_id: requestId,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        provider: providerName,
        screening_id: savedResult?.id || null,
        timestamp: result.timestamp,
        total_hits: result.total_hits,
        overall_status: result.overall_status,
        has_sanction_hit: result.has_sanction_hit,
        has_pep_hit: result.has_pep_hit,
        confirmed_matches: result.confirmed_matches,
        potential_matches: result.potential_matches,
        classified_records: result.classified_records,
        response_hash: result.response_hash,
        next_screening_due: screeningRecord.next_screening_at,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Screening error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
