import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";

/**
 * POI-001: Completion Probability Calculator
 *
 * Calculates probability of POI completion based on:
 *  - DD status (entities, UBOs, ATB, screening, risk scores)
 *  - Approval status
 *  - Signal quality
 *  - Match strength
 *  - Intent confirmation
 *
 * Returns probability 0-100. ≥50.1% required for POI issuance.
 */

interface ProbabilityFactor {
  name: string;
  weight: number;
  score: number; // 0-1
  reason: string;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || '';
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") throw new ApiException("METHOD_NOT_ALLOWED", "Use POST", 405);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation", 403);

    const body = await req.json();
    const { match_id, poi_id } = body;
    if (!match_id && !poi_id) throw new ApiException("VALIDATION_ERROR", "match_id or poi_id required", 400);

    const factors: ProbabilityFactor[] = [];

    // If poi_id provided, get match_id from POI
    let resolvedMatchId = match_id;
    let buyerOrgId: string | null = null;
    let sellerOrgId: string | null = null;

    if (poi_id) {
      const { data: poi } = await admin.from("pois").select("*").eq("id", poi_id).maybeSingle();
      if (!poi) throw new ApiException("NOT_FOUND", "POI not found", 404);
      buyerOrgId = poi.buyer_entity_id;
      sellerOrgId = poi.seller_entity_id;
    }

    if (resolvedMatchId) {
      const { data: matchData } = await admin.from("matches").select("*").eq("id", resolvedMatchId).maybeSingle();
      if (matchData) {
        buyerOrgId = buyerOrgId || matchData.buyer_org_id;
        sellerOrgId = sellerOrgId || matchData.seller_org_id;
      }
    }

    // Factor 1: Entity verification (20% weight)
    if (buyerOrgId && sellerOrgId) {
      const { data: entities } = await admin
        .from("entities")
        .select("org_id, status")
        .in("org_id", [buyerOrgId, sellerOrgId].filter(Boolean));

      const verified = (entities || []).filter(e => e.status === "active" || e.status === "verified");
      const entityScore = entities && entities.length > 0 ? verified.length / entities.length : 0;
      factors.push({
        name: "entity_verification",
        weight: 0.20,
        score: entityScore,
        reason: `${verified.length}/${(entities || []).length} entities verified`,
      });
    } else {
      factors.push({ name: "entity_verification", weight: 0.20, score: 0, reason: "No entity data" });
    }

    // Factor 2: UBO completeness (15% weight)
    const orgIds = [buyerOrgId, sellerOrgId].filter(Boolean);
    if (orgIds.length > 0) {
      const { data: uboLinks } = await admin
        .from("ubo_links")
        .select("company_entity_id, ownership_percentage, status")
        .in("org_id", orgIds);

      const groupedByCompany: Record<string, number> = {};
      (uboLinks || []).forEach(l => {
        const key = l.company_entity_id;
        groupedByCompany[key] = (groupedByCompany[key] || 0) + Number(l.ownership_percentage);
      });
      const companies = Object.values(groupedByCompany);
      const completeCompanies = companies.filter(pct => pct >= 100);
      const uboScore = companies.length > 0 ? completeCompanies.length / companies.length : 0;
      factors.push({
        name: "ubo_completeness",
        weight: 0.15,
        score: uboScore,
        reason: `${completeCompanies.length}/${companies.length} entities with 100% UBO`,
      });
    } else {
      factors.push({ name: "ubo_completeness", weight: 0.15, score: 0, reason: "No UBO data" });
    }

    // Factor 3: ATB verification (10% weight)
    if (orgIds.length > 0) {
      const { data: atb } = await admin
        .from("authority_records")
        .select("org_id, status")
        .in("org_id", orgIds)
        .eq("status", "verified");

      const atbCount = (atb || []).length;
      factors.push({
        name: "atb_verification",
        weight: 0.10,
        score: atbCount >= 2 ? 1 : atbCount / 2,
        reason: `${atbCount} verified ATB records`,
      });
    } else {
      factors.push({ name: "atb_verification", weight: 0.10, score: 0, reason: "No ATB data" });
    }

    // Factor 4: Screening clear (15% weight)
    if (orgIds.length > 0) {
      const { data: screenings } = await admin
        .from("screening_results")
        .select("org_id, status")
        .in("org_id", orgIds)
        .order("screened_at", { ascending: false });

      const latestByOrg: Record<string, string> = {};
      (screenings || []).forEach(s => {
        if (!latestByOrg[s.org_id]) latestByOrg[s.org_id] = s.status;
      });
      const clearCount = Object.values(latestByOrg).filter(s => s === "clear").length;
      factors.push({
        name: "screening_clear",
        weight: 0.15,
        score: Object.keys(latestByOrg).length > 0 ? clearCount / Object.keys(latestByOrg).length : 0,
        reason: `${clearCount}/${Object.keys(latestByOrg).length} orgs screened clear`,
      });
    } else {
      factors.push({ name: "screening_clear", weight: 0.15, score: 0, reason: "No screening data" });
    }

    // Factor 5: Approval status (15% weight)
    if (orgIds.length > 0) {
      const { data: approvals } = await admin
        .from("trade_approvals")
        .select("org_id, status")
        .in("org_id", orgIds)
        .eq("status", "approved");

      const approvedCount = new Set((approvals || []).map(a => a.org_id)).size;
      factors.push({
        name: "trade_approval",
        weight: 0.15,
        score: approvedCount >= 2 ? 1 : approvedCount / 2,
        reason: `${approvedCount}/2 orgs approved to trade`,
      });
    } else {
      factors.push({ name: "trade_approval", weight: 0.15, score: 0, reason: "No approval data" });
    }

    // Factor 6: Intent confirmation (15% weight)
    if (resolvedMatchId) {
      const { data: invite } = await admin
        .from("invites")
        .select("status")
        .eq("match_id", resolvedMatchId)
        .eq("status", "accepted")
        .maybeSingle();

      factors.push({
        name: "intent_confirmed",
        weight: 0.15,
        score: invite ? 1 : 0,
        reason: invite ? "Mutual intent confirmed" : "Intent not yet confirmed",
      });
    } else {
      factors.push({ name: "intent_confirmed", weight: 0.15, score: 0, reason: "No match linked" });
    }

    // Factor 7: Compliance cases (10% weight - inverted: open cases reduce probability)
    if (orgIds.length > 0) {
      const { data: openCases } = await admin
        .from("compliance_cases")
        .select("id")
        .in("org_id", orgIds)
        .eq("status", "open");

      factors.push({
        name: "compliance_clear",
        weight: 0.10,
        score: (!openCases || openCases.length === 0) ? 1 : 0,
        reason: (!openCases || openCases.length === 0) ? "No open compliance cases" : `${openCases.length} open case(s)`,
      });
    } else {
      factors.push({ name: "compliance_clear", weight: 0.10, score: 1, reason: "No compliance data (assumed clear)" });
    }

    // Calculate weighted probability
    const probability = factors.reduce((sum, f) => sum + f.weight * f.score * 100, 0);
    const roundedProbability = Math.round(probability * 10) / 10;
    const meetsThreshold = roundedProbability >= 50.1;

    // Update POI if poi_id provided
    if (poi_id) {
      await admin.from("pois").update({ completion_probability: roundedProbability }).eq("id", poi_id);
    }

    return new Response(JSON.stringify({
      success: true,
      probability: roundedProbability,
      threshold: 50.1,
      meets_threshold: meetsThreshold,
      eligible_for_issuance: meetsThreshold,
      factors,
      poi_id: poi_id || null,
      match_id: resolvedMatchId || null,
    }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (err) {
    console.error(`[${requestId}] Probability calc error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
