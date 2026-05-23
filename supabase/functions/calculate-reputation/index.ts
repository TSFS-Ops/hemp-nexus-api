import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { assertAal2 } from "../_shared/aal.ts";

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const corsResponse = handleCors(req, allowedOrigins);
  if (corsResponse) return corsResponse;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // SECURITY: Authenticate request - only admins can trigger reputation recalculation
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireRole(authCtx, 'platform_admin');

    // SEC-001: reputation recalculation mutates `reputation_scores` rows.
    // It is human-callable from the HQ admin UI (not cron/service-role-only)
    // so platform_admin callers must hold an AAL2/MFA session. API-key
    // callers (back-end automations) skip the JWT aal check.
    if (!authCtx.isApiKey) {
      const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorisation');
      await assertAal2(authHeader, {
        adminClient: supabase,
        callerUserId: authCtx.userId,
        action: 'reputation.recalculate',
        context: {
          sensitive_action_category: 'compliance.reputation',
          target_resource_type: 'reputation_scores',
        },
      });
    }


    // SECURITY: Rate limit admin endpoint to prevent abuse
    // Uses the admin user's org_id for rate limiting
    await checkRateLimit(
      supabase,
      authCtx.orgId,
      null, // No API key for admin auth
      "calculate-reputation",
      "admin:reputation"
    );

    const { orgId } = await req.json();

    // SECURITY: orgId must be provided and valid UUID format
    if (!orgId || typeof orgId !== 'string') {
      throw new ApiException("VALIDATION_ERROR", "orgId is required", 400);
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orgId)) {
      throw new ApiException("VALIDATION_ERROR", "Invalid orgId format", 400);
    }

    // Fetch match data for this org
    const { data: matches } = await supabase
      .from("matches")
      .select("*")
      .eq("org_id", orgId);

    // Fetch signal data
    const { data: signals } = await supabase
      .from("signals")
      .select("id, created_at")
      .eq("org_id", orgId);

    const signalIds = signals?.map(s => s.id) || [];

    // Fetch selection data
    const { data: selections } = signalIds.length > 0 ? await supabase
      .from("selections")
      .select("selected_at, signal_id, signals(created_at)")
      .in("signal_id", signalIds) : { data: null };

    const totalMatches = matches?.length || 0;
    const matchesCompleted = matches?.filter(m => m.status === "settled").length || 0;
    const matchesFailed = matches?.filter(m => m.status === "cancelled").length || 0;
    
    const totalSignals = signals?.length || 0;
    const totalSelections = selections?.length || 0;

    // Calculate response times (signal creation to option selection)
    const responseTimes = selections
      ?.map(sel => {
        const signalTime = new Date((sel as any).signals?.created_at).getTime();
        const selectionTime = new Date(sel.selected_at).getTime();
        return (selectionTime - signalTime) / 1000; // seconds
      })
      .filter(t => !isNaN(t)) || [];

    const avgResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length
      : null;

    const medianResponseTime = responseTimes.length > 0
      ? responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)]
      : null;

    // Calculate scores (0-100)
    
    // Reliability: based on completed vs failed matches
    const reliabilityScore = totalMatches > 0
      ? (matchesCompleted / totalMatches) * 100
      : 0;

    // Responsiveness: based on response time (faster = higher score)
    // Assuming ideal response time is < 1 hour (3600s), poor is > 24 hours (86400s)
    let responsivenessScore = 0;
    if (avgResponseTime !== null) {
      if (avgResponseTime < 3600) responsivenessScore = 100;
      else if (avgResponseTime < 86400) responsivenessScore = 100 - ((avgResponseTime - 3600) / 828.24);
      else responsivenessScore = 0;
    }

    // Completion: based on signals that led to selections
    const completionScore = totalSignals > 0
      ? (totalSelections / totalSignals) * 100
      : 0;

    // Overall score: weighted average
    const overallScore = (reliabilityScore * 0.4) + (responsivenessScore * 0.3) + (completionScore * 0.3);

    // Determine reputation level
    let reputationLevel = "new";
    if (totalMatches >= 100 && overallScore >= 90) reputationLevel = "platinum";
    else if (totalMatches >= 50 && overallScore >= 80) reputationLevel = "gold";
    else if (totalMatches >= 25 && overallScore >= 70) reputationLevel = "silver";
    else if (totalMatches >= 10 && overallScore >= 60) reputationLevel = "bronze";

    // Get first and last match dates
    const matchDates = matches
      ?.filter(m => m.created_at)
      .map(m => new Date(m.created_at))
      .sort((a, b) => a.getTime() - b.getTime()) || [];

    const firstMatchAt = matchDates.length > 0 ? matchDates[0].toISOString() : null;
    const lastMatchAt = matchDates.length > 0 ? matchDates[matchDates.length - 1].toISOString() : null;

    // Upsert reputation score
    const { error: upsertError } = await supabase
      .from("reputation_scores")
      .upsert({
        org_id: orgId,
        total_matches_completed: matchesCompleted,
        total_matches_failed: matchesFailed,
        total_signals_created: totalSignals,
        total_options_selected: totalSelections,
        avg_response_time_seconds: avgResponseTime,
        median_response_time_seconds: medianResponseTime,
        first_match_at: firstMatchAt,
        last_match_at: lastMatchAt,
        reliability_score: reliabilityScore,
        responsiveness_score: responsivenessScore,
        completion_score: completionScore,
        overall_score: overallScore,
        reputation_level: reputationLevel,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: "org_id"
      });

    if (upsertError) throw upsertError;

    return new Response(
      JSON.stringify({ 
        success: true,
        reputation: {
          overallScore,
          level: reputationLevel,
          reliability: reliabilityScore,
          responsiveness: responsivenessScore,
          completion: completionScore,
        }
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error(`[${requestId}] Error calculating reputation:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
