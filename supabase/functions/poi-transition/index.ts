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

    const body = await req.json();
    const { matchId, toState, reason, metadata } = body;

    if (!matchId || !toState) {
      return new Response(
        JSON.stringify({ error: "matchId and toState are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Get current match state
    const { data: match, error: matchError } = await adminClient
      .from("matches")
      .select("id, poi_state, org_id")
      .eq("id", matchId)
      .single();

    if (matchError || !match) {
      return new Response(
        JSON.stringify({ error: "Match not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromState = match.poi_state;

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
        org_id: match.org_id,
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

    // 3. Audit log
    await adminClient.from("audit_logs").insert({
      org_id: match.org_id,
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
  } catch (err) {
    console.error("POI transition error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
