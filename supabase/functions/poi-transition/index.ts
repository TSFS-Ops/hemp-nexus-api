import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Single source of truth: valid transitions ──
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "EXPIRED", "REJECTED"],
  PENDING_APPROVAL: ["ELIGIBLE", "REJECTED", "EXPIRED"],
  ELIGIBLE: ["COLLAPSE_REQUESTED", "EXPIRED", "REJECTED"],
  COLLAPSE_REQUESTED: ["COLLAPSED", "REJECTED"],
  COLLAPSED: ["ANNULLED"],
  EXPIRED: [],
  ANNULLED: [],
  REJECTED: [],
};

const IMMUTABLE_STATES = ["COLLAPSED", "ANNULLED", "EXPIRED", "REJECTED"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── IDOR guard: resolve caller's org_id from profile ──
    const adminClientForProfile = createClient(supabaseUrl, serviceKey);
    const { data: callerProfile, error: profileError } = await adminClientForProfile
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .single();

    if (profileError || !callerProfile?.org_id) {
      return new Response(
        JSON.stringify({ error: "User profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const callerOrgId = callerProfile.org_id;

    const body = await req.json();
    const { matchId, toState, reason, metadata } = body;

    if (!matchId || !toState) {
      return new Response(
        JSON.stringify({ error: "matchId and toState are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Acquire advisory lock to prevent concurrent POI transitions on the same match
    const { error: lockError } = await adminClient.rpc("try_lifecycle_lock");
    const hasLock = !lockError;

    // Get current match state
    const { data: matchRow, error: matchError } = await adminClient
      .from("matches")
      .select("id, poi_state, org_id")
      .eq("id", matchId)
      .single();

    if (matchError || !matchRow) {
      if (hasLock) await adminClient.rpc("release_lifecycle_lock");
      return new Response(
        JSON.stringify({ error: "Match not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
    // ── IDOR enforcement: caller must belong to the match's org ──
    if (matchRow.org_id !== callerOrgId) {
      return new Response(
        JSON.stringify({ error: "Forbidden: you do not have access to this match" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromState = matchRow.poi_state;

    // ── DISC-007: Discovery Gate Enforcement ──
    // POI creation (DRAFT → PENDING_APPROVAL) requires eligibility_status == PASS
    if (fromState === "DRAFT" && toState === "PENDING_APPROVAL") {
      // Find the entity linked to this match's org
      const { data: entities } = await adminClient
        .from("entities")
        .select("id")
        .eq("org_id", matchRow.org_id)
        .limit(10);

      if (entities && entities.length > 0) {
        let discoveryPassed = false;
        for (const entity of entities) {
          const { data: eligibility } = await adminClient
            .from("discovery_eligibility_snapshots")
            .select("eligibility_status, expires_at")
            .eq("entity_id", entity.id)
            .eq("org_id", matchRow.org_id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (
            eligibility &&
            eligibility.eligibility_status === "PASS" &&
            (!eligibility.expires_at || new Date(eligibility.expires_at) > new Date())
          ) {
            discoveryPassed = true;
            break;
          }
        }

        if (!discoveryPassed) {
          // Emit blocked event
          await adminClient.from("event_store").insert({
            org_id: matchRow.org_id,
            domain: "intel",
            aggregate_type: "gate",
            aggregate_id: matchId,
            event_type: "trade.poi.blocked_by_discovery_gate",
            actor_id: user.id,
            payload: { match_id: matchId, from_state: fromState, to_state: toState },
            event_hash: crypto.randomUUID(),
          });

          return new Response(
            JSON.stringify({
              error: "Discovery eligibility PASS required before POI creation. Run discovery evaluation first.",
              code: "DISCOVERY_GATE_FAILED",
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
    }

    // ── Validate transition ──
    const allowed = VALID_TRANSITIONS[fromState];
    if (!allowed || !allowed.includes(toState)) {
      return new Response(
        JSON.stringify({
          error: `Transition from ${fromState} to ${toState} is not permitted`,
          validTransitions: allowed || [],
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Block collapse if approvals not complete ──
    if (toState === "COLLAPSED") {
      // Phase 1: check that state is COLLAPSE_REQUESTED (basic approval gate)
      if (fromState !== "COLLAPSE_REQUESTED") {
        return new Response(
          JSON.stringify({ error: "Collapse blocked: approvals not complete" }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Block field mutations on immutable states ──
    if (IMMUTABLE_STATES.includes(fromState) && toState !== "ANNULLED") {
      return new Response(
        JSON.stringify({ error: `No mutations permitted on ${fromState} POI` }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Execute transition atomically ──
    // 1. Insert append-only event
    const { data: event, error: eventError } = await adminClient
      .from("poi_events")
      .insert({
        match_id: matchId,
        org_id: matchRow.org_id,
        from_state: fromState,
        to_state: toState,
        actor_user_id: user.id,
        reason: reason || null,
        metadata: metadata || {},
      })
      .select()
      .single();

    if (eventError) {
      console.error("Failed to insert poi_event:", eventError);
      return new Response(
        JSON.stringify({ error: "Failed to record transition event" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Update match poi_state
    const { error: updateError } = await adminClient
      .from("matches")
      .update({ poi_state: toState })
      .eq("id", matchId);

    if (updateError) {
      console.error("Failed to update match poi_state:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to update POI state" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Audit log — MANDATORY: failure must propagate as HTTP 500
    const { error: auditError } = await adminClient.from("audit_logs").insert({
      org_id: matchRow.org_id,
      actor_user_id: user.id,
      action: `poi.transition.${fromState.toLowerCase()}_to_${toState.toLowerCase()}`,
      entity_type: "match",
      entity_id: matchId,
      metadata: {
        from_state: fromState,
        to_state: toState,
        reason: reason || null,
        poi_event_id: event.id,
      },
    });

    if (auditError) {
      console.error("CRITICAL: Audit log insert failed for POI transition:", auditError);
      return new Response(
        JSON.stringify({ error: "Audit log failed — transition recorded but audit trail incomplete", code: "AUDIT_LOG_ERROR" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        event: {
          id: event.id,
          from_state: fromState,
          to_state: toState,
          created_at: event.created_at,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    } finally {
      if (hasLock) {
        await adminClient.rpc("release_lifecycle_lock");
      }
    }
  } catch (err) {
    console.error("POI transition error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
