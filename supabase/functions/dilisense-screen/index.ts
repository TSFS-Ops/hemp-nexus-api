import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";

/**
 * Dilisense AML Screening Edge Function
 *
 * Provides real sanctions, PEP, and criminal screening via Dilisense API.
 * Supports both individual (checkIndividual) and entity (checkEntity) screening.
 *
 * POST body:
 *   { org_id, screen_type: "individual"|"entity", name, fuzzy_search?: 1|2, dob?: string, gender?: string }
 *
 * Returns normalised screening result and stores in screening_results table.
 */

const DILISENSE_BASE = "https://api.dilisense.com/v1";

interface DilisenseRecord {
  id: string;
  name: string;
  source_type: string; // SANCTION | PEP | CRIMINAL | OTHER
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

function classifyMatch(record: DilisenseRecord, searchName: string): "confirmed" | "potential" | "no_match" {
  // Normalise for comparison
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const normSearch = norm(searchName);
  const normName = norm(record.name || "");

  // Exact name match = confirmed
  if (normName === normSearch) return "confirmed";

  // Check aliases
  const aliases = (record.alias_names || []).map(norm);
  if (aliases.includes(normSearch)) return "confirmed";

  // Fuzzy similarity check (Jaccard on bigrams)
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

    const dilisenseKey = Deno.env.get("DILISENSE_API_KEY");
    if (!dilisenseKey) {
      throw new ApiException("CONFIGURATION_ERROR", "Dilisense API key not configured", 500);
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
    const endpoint = type === "entity" ? "checkEntity" : "checkIndividual";

    // Build Dilisense query params
    const params = new URLSearchParams();
    params.set("names", name);
    if (fuzzy_search) params.set("fuzzy_search", String(fuzzy_search));
    if (dob) params.set("dob", dob);
    if (gender) params.set("gender", gender);

    // Call Dilisense API
    const dilisenseUrl = `${DILISENSE_BASE}/${endpoint}?${params.toString()}`;
    const dilisenseRes = await fetch(dilisenseUrl, {
      method: "GET",
      headers: { "x-api-key": dilisenseKey },
    });

    if (!dilisenseRes.ok) {
      const errText = await dilisenseRes.text();
      console.error(`Dilisense API error [${dilisenseRes.status}]:`, errText);
      throw new ApiException(
        "PROVIDER_ERROR",
        `Screening provider returned ${dilisenseRes.status}`,
        502,
        { providerStatus: dilisenseRes.status }
      );
    }

    const dilisenseData: DilisenseResponse = await dilisenseRes.json();

    // Classify each hit per BRD SAN-002
    const classifiedRecords = dilisenseData.found_records.map((record) => {
      const matchLevel = classifyMatch(record, name);
      return {
        dilisense_id: record.id,
        name: record.name,
        source_type: record.source_type,
        pep_type: record.pep_type || null,
        source_id: record.source_id,
        match_level: matchLevel,
        alias_names: record.alias_names || [],
        date_of_birth: record.date_of_birth || [],
        citizenship: record.citizenship || [],
        sanction_details: record.sanction_details || [],
        positions: record.positions || [],
        description: record.description || [],
      };
    });

    const confirmedMatches = classifiedRecords.filter(r => r.match_level === "confirmed");
    const potentialMatches = classifiedRecords.filter(r => r.match_level === "potential");
    const hasSanctionHit = confirmedMatches.some(r => r.source_type === "SANCTION");
    const hasPepHit = classifiedRecords.some(r => r.source_type === "PEP" && r.match_level !== "no_match");

    // Determine overall status per BRD:
    // Confirmed sanction → "match" (block immediately)
    // Potential → "review" (manual review required)
    // No match → "clear"
    let overallStatus: string;
    if (hasSanctionHit) {
      overallStatus = "match";
    } else if (confirmedMatches.length > 0 || potentialMatches.length > 0) {
      overallStatus = "review";
    } else {
      overallStatus = "clear";
    }

    // Compute response hash for audit trail
    const responsePayload = JSON.stringify(dilisenseData);
    const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(responsePayload));
    const responseHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Store screening result
    const screeningRecord = {
      org_id,
      screening_type: "sanctions_pep",
      status: overallStatus,
      matched_entities: classifiedRecords.filter(r => r.match_level !== "no_match"),
      screened_at: new Date().toISOString(),
      screened_by: actorUserId || null,
      next_screening_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days per BRD RS-001
    };

    const { data: savedResult, error: saveErr } = await adminClient
      .from("screening_results")
      .insert(screeningRecord)
      .select()
      .single();

    if (saveErr) {
      console.error("Failed to save screening result:", saveErr);
    }

    // Audit log
    await adminClient.from("audit_logs").insert({
      org_id,
      actor_user_id: actorUserId || null,
      action: `screening.${type}.completed`,
      entity_type: "screening_results",
      entity_id: savedResult?.id || null,
      metadata: {
        provider: "dilisense",
        endpoint,
        name_screened: name,
        entity_id: entity_id || null,
        total_hits: dilisenseData.total_hits,
        confirmed_matches: confirmedMatches.length,
        potential_matches: potentialMatches.length,
        overall_status: overallStatus,
        response_hash: responseHash,
        request_id: requestId,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        provider: "dilisense",
        screening_id: savedResult?.id || null,
        timestamp: dilisenseData.timestamp,
        total_hits: dilisenseData.total_hits,
        overall_status: overallStatus,
        has_sanction_hit: hasSanctionHit,
        has_pep_hit: hasPepHit,
        confirmed_matches: confirmedMatches.length,
        potential_matches: potentialMatches.length,
        classified_records: classifiedRecords.filter(r => r.match_level !== "no_match"),
        response_hash: responseHash,
        next_screening_due: screeningRecord.next_screening_at,
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Dilisense screening error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
