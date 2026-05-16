import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiGuardPrecheck, guardedAiCall, aiGuardEnvelope } from "../_shared/ai-guard.ts";

/**
 * DISC-002 OSINT Discovery Crawler
 * 
 * POST /intel-crawl         → Request new OSINT crawl for an entity
 * GET  /intel-crawl?crawl_id=  → Retrieve crawl results by ID
 * GET  /intel-crawl?entity_id= → List crawls for an entity
 *
 * Events emitted:
 *   intel.crawl.requested
 *   intel.crawl.completed
 *   intel.crawl.failed
 *   intel.public_presence.assessed (DISC-003)
 */

const CrawlRequestSchema = z.object({
  entity_id: z.string().uuid(),
  entity_name: z.string().min(1).max(500),
  company_identifiers: z.array(z.string()).optional().default([]),
  domain_names: z.array(z.string()).optional().default([]),
});

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * DISC-003 Public Presence Score
 * R = NEWS + SOCIAL + WEB reference counts
 * Score = min(10, floor(ln(R+1) * 3))
 */
function calculatePublicPresenceScore(news: number, social: number, web: number): number {
  const R = news + social + web;
  return Math.min(10, Math.floor(Math.log(R + 1) * 3));
}

/**
 * Simulate OSINT crawl using available search infrastructure.
 * In production this calls the configured CRAWL_PROVIDER.
 */
async function executeOsintCrawl(
  entityName: string,
  companyIds: string[],
  domains: string[],
  supabaseUrl: string,
  serviceKey: string,
): Promise<{
  news_count: number;
  social_count: number;
  web_count: number;
  entity_confidence: number;
  sources: string[];
  results: Record<string, unknown>;
}> {
  const searchApiKey = Deno.env.get("SEARCH_API_KEY") || Deno.env.get("CRAWL_API_KEY");
  const searchProvider = Deno.env.get("SEARCH_PROVIDER") || Deno.env.get("CRAWL_PROVIDER") || "mock";

  // Build search queries for each category
  const newsQuery = `"${entityName}" news OR press OR announcement`;
  const socialQuery = `"${entityName}" site:linkedin.com OR site:twitter.com OR site:facebook.com`;
  const webQuery = `"${entityName}" ${domains.length > 0 ? domains[0] : ""} company`;

  let newsCount = 0;
  let socialCount = 0;
  let webCount = 0;
  let entityConfidence = 0;
  const sources: string[] = [];
  const results: Record<string, unknown> = {};

  if (!searchApiKey) {
    // No API key configured - return zeros instead of fake data
    newsCount = 0;
    socialCount = 0;
    webCount = 0;
    entityConfidence = 0;
    sources.push("none");
    results.unavailable = true;
    results.reason = "SEARCH_API_KEY not configured";
  } else {
    // Use real search infrastructure
    try {
      const admin = createClient(supabaseUrl, serviceKey);

      // Execute parallel searches via the search edge function
      const searchQueries = [
        { query: newsQuery, type: "news" },
        { query: socialQuery, type: "social" },
        { query: webQuery, type: "web" },
      ];

      for (const sq of searchQueries) {
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/web-search`, {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ query: sq.query, max_results: 20 }),
          });

          if (response.ok) {
            const data = await response.json();
            const count = data?.results?.length || data?.data?.length || 0;
            if (sq.type === "news") newsCount = count;
            if (sq.type === "social") socialCount = count;
            if (sq.type === "web") webCount = count;
            sources.push(sq.type);
            results[sq.type] = { count, query: sq.query };
          }
        } catch (e) {
          console.error(`Search failed for ${sq.type}:`, e);
        }
      }

      // Calculate entity confidence based on cross-source consistency
      const totalRefs = newsCount + socialCount + webCount;
      const sourcesFound = [newsCount > 0, socialCount > 0, webCount > 0].filter(Boolean).length;
      entityConfidence = totalRefs > 0
        ? Math.min(1, (sourcesFound / 3) * 0.5 + Math.min(totalRefs / 30, 0.5))
        : 0;
    } catch (e) {
      console.error("OSINT crawl error:", e);
      throw e;
    }
  }

  return {
    news_count: newsCount,
    social_count: socialCount,
    web_count: webCount,
    entity_confidence: Math.round(entityConfidence * 100) / 100,
    sources,
    results,
  };
}

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req, Deno.env.get("ALLOWED_ORIGINS") || "*");
  if (corsResp) return corsResp;

  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
  const headers = { ...corsHeaders(Deno.env.get("ALLOWED_ORIGINS") || "*", req.headers.get("origin")), "Content-Type": "application/json" };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const { actorUserId } = deriveActorIds(authCtx);
    const admin = createClient(supabaseUrl, serviceKey);

    // ── GET: Retrieve crawl results ──
    if (req.method === "GET") {
      const url = new URL(req.url);
      const crawlId = url.searchParams.get("crawl_id");
      const entityId = url.searchParams.get("entity_id");

      if (crawlId) {
        const { data, error } = await admin
          .from("intel_crawl_runs")
          .select("*")
          .eq("id", crawlId)
          .eq("org_id", orgId)
          .maybeSingle();

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
        if (!data) throw new ApiException("NOT_FOUND", "Crawl run not found", 404);

        // Calculate public presence score (DISC-003)
        const presenceScore = calculatePublicPresenceScore(
          data.news_reference_count || 0,
          data.social_reference_count || 0,
          data.web_reference_count || 0,
        );

        return new Response(JSON.stringify({
          status: "SUCCESS",
          correlation_id: correlationId,
          data: { ...data, public_presence_score: presenceScore },
        }), { headers });
      }

      if (entityId) {
        const { data, error } = await admin
          .from("intel_crawl_runs")
          .select("*")
          .eq("entity_id", entityId)
          .eq("org_id", orgId)
          .order("created_at", { ascending: false })
          .limit(20);

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

        return new Response(JSON.stringify({
          status: "SUCCESS",
          correlation_id: correlationId,
          data: data || [],
        }), { headers });
      }

      throw new ApiException("VALIDATION_ERROR", "crawl_id or entity_id query parameter required", 400);
    }

    // ── POST: Request new OSINT crawl ──
    if (req.method === "POST") {
      const body = await req.json();
      const parsed = CrawlRequestSchema.parse(body);

      // Verify entity belongs to org
      const { data: entity } = await admin
        .from("entities")
        .select("id, legal_name, org_id")
        .eq("id", parsed.entity_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!entity) throw new ApiException("NOT_FOUND", "Entity not found or not owned by org", 404);

      // Insert crawl run as PENDING
      const { data: crawlRun, error: insertErr } = await admin
        .from("intel_crawl_runs")
        .insert({
          entity_id: parsed.entity_id,
          org_id: orgId,
          status: "PENDING",
          actor_user_id: actorUserId || null,
          sources: [],
          results: {},
        })
        .select()
        .single();

      if (insertErr) throw new ApiException("INTERNAL_ERROR", insertErr.message, 500);

      // Emit intel.crawl.requested event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "intel",
        aggregate_type: "crawl",
        aggregate_id: crawlRun.id,
        event_type: "intel.crawl.requested",
        actor_id: actorUserId || null,
        payload: { entity_id: parsed.entity_id, entity_name: parsed.entity_name },
        event_hash: await computeHash(JSON.stringify({ crawl_id: crawlRun.id, entity_id: parsed.entity_id })),
      });

      // Batch F: AI guard precheck (cooldown + daily meter) before delegating
      // to web-search. Prevents refresh-spam from tunneling through.
      const guard = await aiGuardPrecheck(admin, { org_id: orgId, call_type: "intel_crawl" });
      if (guard.kind === "cooldown" || guard.kind === "quota_exceeded") {
        const env = aiGuardEnvelope(guard);
        return new Response(JSON.stringify({
          status: "ERROR", correlation_id: correlationId,
          error: { code: guard.kind === "quota_exceeded" ? "QUOTA_EXCEEDED" : "AI_PROVIDER_COOLDOWN",
                   message: (env.body as any).message },
        }), { status: env.status, headers });
      }

      // Execute crawl (synchronous for now - can be async in production)
      try {
        const crawlResult = await executeOsintCrawl(
          parsed.entity_name,
          parsed.company_identifiers,
          parsed.domain_names,
          supabaseUrl,
          serviceKey,
        );

        // Update crawl run with results
        await admin
          .from("intel_crawl_runs")
          .update({
            status: "COMPLETED",
            completed_at: new Date().toISOString(),
            news_reference_count: crawlResult.news_count,
            social_reference_count: crawlResult.social_count,
            web_reference_count: crawlResult.web_count,
            entity_match_confidence: crawlResult.entity_confidence,
            sources: crawlResult.sources,
            results: crawlResult.results,
          })
          .eq("id", crawlRun.id);

        // Emit intel.crawl.completed
        await admin.from("event_store").insert({
          org_id: orgId,
          domain: "intel",
          aggregate_type: "crawl",
          aggregate_id: crawlRun.id,
          event_type: "intel.crawl.completed",
          actor_id: actorUserId || null,
          payload: {
            news_count: crawlResult.news_count,
            social_count: crawlResult.social_count,
            web_count: crawlResult.web_count,
            entity_confidence: crawlResult.entity_confidence,
          },
          event_hash: await computeHash(JSON.stringify(crawlResult)),
        });

        // DISC-003: Emit public presence assessed event
        const presenceScore = calculatePublicPresenceScore(
          crawlResult.news_count,
          crawlResult.social_count,
          crawlResult.web_count,
        );

        await admin.from("event_store").insert({
          org_id: orgId,
          domain: "intel",
          aggregate_type: "crawl",
          aggregate_id: crawlRun.id,
          event_type: "intel.public_presence.assessed",
          actor_id: actorUserId || null,
          payload: {
            R: crawlResult.news_count + crawlResult.social_count + crawlResult.web_count,
            public_presence_score: presenceScore,
            entity_id: parsed.entity_id,
          },
          event_hash: await computeHash(JSON.stringify({ presenceScore, entity_id: parsed.entity_id })),
        });

        // Audit log
        await admin.from("audit_logs").insert({
          org_id: orgId,
          actor_user_id: actorUserId || null,
          action: "intel.crawl.completed",
          entity_type: "intel_crawl_run",
          entity_id: crawlRun.id,
          metadata: {
            entity_id: parsed.entity_id,
            public_presence_score: presenceScore,
          },
        });

        return new Response(JSON.stringify({
          status: "SUCCESS",
          correlation_id: correlationId,
          data: {
            crawl_id: crawlRun.id,
            entity_id: parsed.entity_id,
            status: "COMPLETED",
            news_reference_count: crawlResult.news_count,
            social_reference_count: crawlResult.social_count,
            web_reference_count: crawlResult.web_count,
            entity_match_confidence: crawlResult.entity_confidence,
            public_presence_score: presenceScore,
          },
        }), { status: 202, headers });

      } catch (crawlErr) {
        // Mark as FAILED
        await admin
          .from("intel_crawl_runs")
          .update({ status: "FAILED", completed_at: new Date().toISOString() })
          .eq("id", crawlRun.id);

        await admin.from("event_store").insert({
          org_id: orgId,
          domain: "intel",
          aggregate_type: "crawl",
          aggregate_id: crawlRun.id,
          event_type: "intel.crawl.failed",
          actor_id: actorUserId || null,
          payload: { error: crawlErr instanceof Error ? crawlErr.message : "Unknown error" },
          event_hash: await computeHash(JSON.stringify({ crawl_id: crawlRun.id, error: true })),
        });

        throw new ApiException("INTERNAL_ERROR", "OSINT crawl failed", 500);
      }
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
    console.error("intel-crawl error:", err);
    return new Response(JSON.stringify({
      status: "ERROR", correlation_id: correlationId,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    }), { status: 500, headers });
  }
});
