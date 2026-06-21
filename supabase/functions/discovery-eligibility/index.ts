import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * DISC-006 Discovery Eligibility Evaluation
 *
 * GET  ?entity_id=  → Retrieve latest eligibility snapshot
 * POST              → Compute new eligibility snapshot
 *
 * Scoring (DISC-006):
 *   +20  ID_VERIFIED
 *   +5   CONTACT_VERIFIED
 *   +20  COMPANY_EXISTS
 *   +10  EMAIL_DOMAIN_MATCH
 *   +OPERATING_FOOTPRINT_SCORE (0-10)
 *   +PUBLIC_PRESENCE_SCORE (0-10)
 *   +5   AUTHORITY_DOCUMENT_PRESENT
 *   +min(5, OTHER_SUPPORTING_COLLATERAL_COUNT)
 *
 * Hard Fails: SANCTIONS_STATUS==CONFIRMED_MATCH, ID_VERIFIED==FALSE, COMPANY_EXISTS==FALSE
 * Review:     SANCTIONS_STATUS==POTENTIAL_MATCH, ENTITY_MATCH_CONFIDENCE<0.70
 *
 * Thresholds: PASS ≥65, REVIEW 45-64, FAIL <45
 */

const EvalRequestSchema = z.object({
  entity_id: z.string().uuid(),
  signals: z.object({
    id_verified: z.boolean().optional().default(false),
    contact_verified: z.boolean().optional().default(false),
    company_exists: z.boolean().optional().default(false),
    email_domain_match: z.boolean().optional().default(false),
    operating_footprint_score: z.number().min(0).max(10).optional().default(0),
    declared_role: z.string().optional(),
    authority_document_present: z.boolean().optional().default(false),
    sanctions_status: z.enum(["CLEAR", "POTENTIAL_MATCH", "CONFIRMED_MATCH"]).optional().default("CLEAR"),
  }).optional(),
});

function calculatePublicPresenceScore(news: number, social: number, web: number): number {
  const R = news + social + web;
  return Math.min(10, Math.floor(Math.log(R + 1) * 3));
}

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || '');
  if (corsResp) return corsResp;

  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
  const headers = { ...corsHeaders(Deno.env.get("ALLOWED_ORIGINS") || '', req.headers.get("origin")), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const { actorUserId } = deriveActorIds(authCtx);
    const admin = createClient(supabaseUrl, serviceKey);

    // ── GET: Retrieve latest eligibility snapshot ──
    if (req.method === "GET") {
      const url = new URL(req.url);
      const entityId = url.searchParams.get("entity_id");
      if (!entityId) throw new ApiException("VALIDATION_ERROR", "entity_id query parameter required", 400);

      const { data, error } = await admin
        .from("discovery_eligibility_snapshots")
        .select("*")
        .eq("entity_id", entityId)
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
      if (!data) throw new ApiException("NOT_FOUND", "No eligibility snapshot found. Run an eligibility evaluation first.", 404);

      // Check expiry (30 days)
      const expired = data.expires_at && new Date(data.expires_at) < new Date();

      return new Response(JSON.stringify({
        status: "SUCCESS",
        correlation_id: correlationId,
        data: { ...data, expired },
      }), { headers });
    }

    // ── POST: Compute new eligibility snapshot ──
    if (req.method === "POST") {
      const body = await req.json();
      const parsed = EvalRequestSchema.parse(body);
      const entityId = parsed.entity_id;

      // Verify entity belongs to org
      const { data: entity } = await admin
        .from("entities")
        .select("id, legal_name, org_id, status, entity_type")
        .eq("id", entityId)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!entity) throw new ApiException("NOT_FOUND", "Entity not found or not owned by org", 404);

      // Gather signals from various sources
      const signals = parsed.signals || {};

      // Get latest crawl results (DISC-002/003)
      const { data: latestCrawl } = await admin
        .from("intel_crawl_runs")
        .select("*")
        .eq("entity_id", entityId)
        .eq("org_id", orgId)
        .eq("status", "COMPLETED")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const publicPresenceScore = latestCrawl
        ? calculatePublicPresenceScore(
            latestCrawl.news_reference_count || 0,
            latestCrawl.social_reference_count || 0,
            latestCrawl.web_reference_count || 0,
          )
        : 0;

      const entityMatchConfidence = latestCrawl?.entity_match_confidence || 0;

      // Get vault collateral count (DISC-004)
      const { count: collateralCount } = await admin
        .from("vault_documents")
        .select("id", { count: "exact", head: true })
        .eq("entity_id", entityId)
        .eq("org_id", orgId);

      // Get screening results (DISC-005)
      const { data: latestScreening } = await admin
        .from("screening_results")
        .select("*")
        .eq("entity_id", entityId)
        .order("screened_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let sanctionsStatus = signals.sanctions_status || "CLEAR";
      if (latestScreening) {
        if (latestScreening.match_type === "confirmed") sanctionsStatus = "CONFIRMED_MATCH";
        else if (latestScreening.match_type === "potential" || (latestScreening.similarity_score && latestScreening.similarity_score >= 0.92)) {
          sanctionsStatus = "POTENTIAL_MATCH";
        }
      }

      // Get authority records
      const { data: authorityRecs } = await admin
        .from("authority_records")
        .select("id, status")
        .eq("company_entity_id", entityId)
        .eq("status", "verified")
        .limit(1);

      const authorityDocPresent = signals.authority_document_present || (authorityRecs && authorityRecs.length > 0);

      // ── Compute eligibility score (DISC-006) ──
      const idVerified = signals.id_verified || entity.status === "active" || entity.status === "ACTIVE";
      const companyExists = signals.company_exists || entity.entity_type === "company";
      const contactVerified = signals.contact_verified || false;
      const emailDomainMatch = signals.email_domain_match || false;
      const operatingFootprintScore = signals.operating_footprint_score || 0;

      let baseScore = 0;
      if (idVerified) baseScore += 20;
      if (contactVerified) baseScore += 5;
      if (companyExists) baseScore += 20;
      if (emailDomainMatch) baseScore += 10;
      baseScore += operatingFootprintScore; // 0-10
      baseScore += publicPresenceScore;     // 0-10
      if (authorityDocPresent) baseScore += 5;
      baseScore += Math.min(5, collateralCount || 0);

      // ── Hard Fail checks ──
      const hardFailReasons: string[] = [];
      if (sanctionsStatus === "CONFIRMED_MATCH") hardFailReasons.push("SANCTIONS_STATUS == CONFIRMED_MATCH");
      if (!idVerified) hardFailReasons.push("ID_VERIFIED == FALSE");
      if (!companyExists) hardFailReasons.push("COMPANY_EXISTS == FALSE");

      // ── Review triggers ──
      const reviewReasons: string[] = [];
      if (sanctionsStatus === "POTENTIAL_MATCH") reviewReasons.push("SANCTIONS_STATUS == POTENTIAL_MATCH");
      if (entityMatchConfidence < 0.70 && latestCrawl) reviewReasons.push(`ENTITY_MATCH_CONFIDENCE < 0.70 (${entityMatchConfidence})`);

      // ── Determine status ──
      let eligibilityStatus: "PASS" | "REVIEW" | "FAIL";
      if (hardFailReasons.length > 0) {
        eligibilityStatus = "FAIL";
      } else if (reviewReasons.length > 0) {
        eligibilityStatus = "REVIEW";
      } else if (baseScore >= 65) {
        eligibilityStatus = "PASS";
      } else if (baseScore >= 45) {
        eligibilityStatus = "REVIEW";
      } else {
        eligibilityStatus = "FAIL";
      }

      // Store snapshot
      const signalsPayload = {
        id_verified: idVerified,
        contact_verified: contactVerified,
        company_exists: companyExists,
        email_domain_match: emailDomainMatch,
        operating_footprint_score: operatingFootprintScore,
        public_presence_score: publicPresenceScore,
        entity_match_confidence: entityMatchConfidence,
        authority_document_present: authorityDocPresent,
        sanctions_status: sanctionsStatus,
        other_supporting_collateral_count: collateralCount || 0,
        declared_role: signals.declared_role || null,
      };

      const { data: snapshot, error: snapErr } = await admin
        .from("discovery_eligibility_snapshots")
        .insert({
          entity_id: entityId,
          org_id: orgId,
          crawl_id: latestCrawl?.id || null,
          eligibility_score: baseScore,
          eligibility_status: eligibilityStatus,
          signals: signalsPayload,
          hard_fail_reasons: hardFailReasons,
          review_reasons: reviewReasons,
        })
        .select()
        .single();

      if (snapErr) throw new ApiException("INTERNAL_ERROR", snapErr.message, 500);

      // Emit appropriate event
      const eventType = eligibilityStatus === "PASS"
        ? "trade.discovery.eligibility_passed"
        : eligibilityStatus === "REVIEW"
          ? "trade.discovery.eligibility_review"
          : "trade.discovery.eligibility_failed";

      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "intel",
        aggregate_type: "eligibility",
        aggregate_id: snapshot.id,
        event_type: eventType,
        actor_id: actorUserId || null,
        payload: {
          entity_id: entityId,
          score: baseScore,
          status: eligibilityStatus,
          hard_fails: hardFailReasons,
          review_triggers: reviewReasons,
        },
        event_hash: await computeHash(JSON.stringify({ snapshot_id: snapshot.id, score: baseScore })),
      });

      // Audit log
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: actorUserId || null,
        action: `discovery.eligibility.${eligibilityStatus.toLowerCase()}`,
        entity_type: "discovery_eligibility_snapshot",
        entity_id: snapshot.id,
        metadata: {
          entity_id: entityId,
          score: baseScore,
          status: eligibilityStatus,
        },
      });

      return new Response(JSON.stringify({
        status: "SUCCESS",
        correlation_id: correlationId,
        data: {
          snapshot_id: snapshot.id,
          entity_id: entityId,
          eligibility_score: baseScore,
          eligibility_status: eligibilityStatus,
          signals: signalsPayload,
          hard_fail_reasons: hardFailReasons,
          review_reasons: reviewReasons,
          expires_at: snapshot.expires_at,
        },
      }), { status: 200, headers });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return new Response(JSON.stringify({
        status: "ERROR", correlation_id: correlationId,
        error: { code: "VALIDATION_ERROR", message: err.errors.map(e => e.message).join(", ") },
      }), { status: 400, headers });
    }
    if (err instanceof ApiException) {
      return new Response(JSON.stringify({
        status: "ERROR", correlation_id: correlationId,
        error: { code: err.code, message: err.message },
      }), { status: err.statusCode, headers });
    }
    console.error("discovery-eligibility error:", err);
    return new Response(JSON.stringify({
      status: "ERROR", correlation_id: correlationId,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    }), { status: 500, headers });
  }
});
