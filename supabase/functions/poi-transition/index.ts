import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  lookupIdempotentResponse,
  storeIdempotentResponse,
  cachedResponseToHttp,
} from "../_shared/idempotency.ts";
import { checkMaintenanceMode } from "../_shared/test-mode-bypass.ts";
import { isActorLegalNameMissing } from "./legal-name-guard.ts";
import { handleCorsPreflight, withCors } from "../_shared/cors.ts";
import { assertEngagementAllowsProgression } from "../_shared/engagement-progression-guard.ts";
import { assertNoOpenChallenge, challengeOpenResponse } from "../_shared/challenge-progression-guard.ts";
import {
  assertMatchProgressable,
  buildProgressionGuardResponse,
} from "../_shared/match-progression-guard.ts";
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "../_shared/governance-audit-integration.ts";
import { POI_POLICY_VERSION } from "../_shared/governance-policy-versions.ts";

// Stage 2A CORS hardening (2026-05-01): replaced local wildcard `corsHeaders`
// with the shared `_shared/cors.ts` helper. Stub keeps existing spreads valid.
const corsHeaders = { "Content-Type": "application/json" } as Record<string, string>;

// ── Single source of truth: valid transitions ──
const VALID_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "EXPIRED", "REJECTED"],
  PENDING_APPROVAL: ["ELIGIBLE", "REJECTED", "EXPIRED"],
  ELIGIBLE: ["COMPLETION_REQUESTED", "EXPIRED", "REJECTED"],
  COMPLETION_REQUESTED: ["COMPLETED", "REJECTED"],
  COMPLETED: ["ANNULLED"],
  EXPIRED: [],
  ANNULLED: [],
  REJECTED: [],
};

const IMMUTABLE_STATES = ["COMPLETED", "ANNULLED", "EXPIRED", "REJECTED"];

Deno.serve(async (req: Request) => {
  const preflight = handleCorsPreflight(req);
  if (preflight) return preflight;
  return withCors(req, await _serve(req));
});

async function _serve(req: Request): Promise<Response> {

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

    // Verify user — use positional auth.getUser(jwt) form (Phase 2b invariant);
    // the header-based form silently returns null when no session is attached
    // to the client, which manifests as a spurious 401 on valid bearer tokens.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const bearer = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authError } = await userClient.auth.getUser(bearer);
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

    // ── Maintenance gate (platform admins are exempt) ──
    const maintenanceClient = createClient(supabaseUrl, serviceKey);
    const maintenance = await checkMaintenanceMode(maintenanceClient, {
      source: "poi-transition",
      actorUserId: user.id,
      orgId: callerOrgId,
      action: "poi_transition",
    });
    if (maintenance.blocked) {
      return new Response(
        JSON.stringify({
          error: "Service temporarily unavailable — platform is in maintenance mode.",
          code: "MAINTENANCE_MODE",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Rate limit: protect lock contention and DB writes
    const rlClient = createClient(supabaseUrl, serviceKey);
    await checkRateLimit(rlClient, callerOrgId, null, "/poi-transition", "match");

    const body = await req.json();
    const { matchId, toState, reason, metadata } = body;

    if (!matchId || !toState) {
      return new Response(
        JSON.stringify({ error: "matchId and toState are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);

    // ── Idempotency: short-circuit duplicate transitions ──
    // Header is REQUIRED (hard-mode) — POI state transitions are irreversible
    // and re-firing them on retry can advance a match past where the user
    // intended (e.g. discovery → committed twice charges twice in pathological
    // cases). Refuse the call rather than silently letting the second through.
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return new Response(
        JSON.stringify({ error: "Idempotency-Key header is required", code: "IDEMPOTENCY_KEY_REQUIRED" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const idemOpts = {
      supabase: adminClient,
      orgId: callerOrgId,
      endpoint: "POST /poi-transition",
      idempotencyKey,
      requestHash: `${matchId}:${toState}`,
    };
    const cached = await lookupIdempotentResponse(idemOpts);
    if (cached) {
      return cachedResponseToHttp(cached, { ...corsHeaders });
    }

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

    // ── LEGITIMACY GATE on forward, counterparty-facing transitions ──
    // Mint already enforces the gate (pois/, match/). This adds the same
    // protection on state advancement so an already-created POI cannot
    // progress into a formal/counterparty-facing state while the issuing
    // org's verification has lapsed, been revoked, or never been granted.
    //
    // Cleanup/terminal exits (EXPIRED/REJECTED/ANNULLED) are intentionally
    // NOT gated — those are admin/lifecycle paths that must remain reachable
    // even when the org has lost legitimacy.
    {
      const FORWARD_COUNTERPARTY_FACING = new Set([
        "PENDING_APPROVAL",
        "ELIGIBLE",
        "COMPLETION_REQUESTED",
        "COMPLETED",
      ]);
      if (FORWARD_COUNTERPARTY_FACING.has(String(toState))) {
        const { checkOrgLegitimacy, ORG_NOT_VERIFIED_CODE } = await import("../_shared/legitimacy.ts");
        const { checkUserPoiAuthority, USER_NOT_AUTHORISED_CODE, authorityAuditMetadata } = await import("../_shared/poi-authority.ts");

        // (1) User-authority gate — verified org alone is not sufficient.
        const authority = await checkUserPoiAuthority(adminClient, user.id, callerOrgId);
        if (!authority.allowed) {
          try {
            await adminClient.from("admin_audit_logs").insert({
              actor_user_id: user.id,
              org_id: callerOrgId,
              action: "legitimacy.gate_blocked",
              entity_type: "match",
              entity_id: matchId,
              metadata: authorityAuditMetadata(authority, {
                endpoint: "poi-transition",
                from_state: fromState,
                to_state: toState,
                gate_position: "user_authority",
              }),
            });
          } catch (auditErr) {
            console.error("Failed to write authority denial audit row (poi-transition):", auditErr);
          }
          if (hasLock) await adminClient.rpc("release_lifecycle_lock");
          return new Response(
            JSON.stringify({
              error: authority.message,
              code: USER_NOT_AUTHORISED_CODE,
              reason: authority.reason,
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        // (2) Org-legitimacy gate (existing).
        const legitimacy = await checkOrgLegitimacy(adminClient, callerOrgId, "poi_mint");
        if (!legitimacy.allowed) {
          try {
            await adminClient.from("admin_audit_logs").insert({
              actor_user_id: user.id,
              org_id: callerOrgId,
              action: "legitimacy.gate_blocked",
              entity_type: "match",
              entity_id: matchId,
              metadata: {
                endpoint: "poi-transition",
                from_state: fromState,
                to_state: toState,
                legitimacy_reason: legitimacy.reason,
                trade_approval_status: legitimacy.status,
                valid_until: legitimacy.validUntil,
                gate_position: legitimacy.gatePosition,
                reason_code: ORG_NOT_VERIFIED_CODE,
              },
            });
          } catch (auditErr) {
            console.error("Failed to write legitimacy denial audit row (poi-transition):", auditErr);
          }
          if (hasLock) await adminClient.rpc("release_lifecycle_lock");
          return new Response(
            JSON.stringify({
              error: legitimacy.message,
              code: ORG_NOT_VERIFIED_CODE,
              reason: legitimacy.reason,
              gate_position: legitimacy.gatePosition,
            }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
    }


    // ── MT-008 / MT-009 server-side progression guard ──
    // Block before ANY side effect (event insert, atomic_token_burn, etc.):
    //   MT-008 → inconsistent / legacy-admin-hold rows return 409
    //            MT_008_INCONSISTENT_MATCH | MT_008_LEGACY_ADMIN_HOLD
    //   MT-009 → org-attached row missing named contact returns 409
    //            MT_009_NAMED_CONTACT_REQUIRED
    {
      const decision = await assertMatchProgressable({
        supabase: adminClient,
        matchId,
        action: "poi_transition",
        sourceFunction: "poi-transition",
        actorUserId: user.id,
        actorOrgId: callerOrgId,
      });
      const blocked = buildProgressionGuardResponse(decision, corsHeaders);
      if (blocked) {
        if (hasLock) await adminClient.rpc("release_lifecycle_lock");
        return blocked;
      }
    }

    // ── Gap (b): Server-side legal-name enforcement on POI generation ──
    // The actor's profiles.full_name must be a real legal name (not null,
    // not empty, not their email address) before they can move a match
    // out of DRAFT into PENDING_APPROVAL (i.e. generate a POI).
    if (fromState === "DRAFT" && toState === "PENDING_APPROVAL") {
      const { data: actorProfile } = await adminClient
        .from("profiles")
        .select("full_name, email")
        .eq("id", user.id)
        .maybeSingle();

      if (isActorLegalNameMissing(actorProfile)) {
        if (hasLock) await adminClient.rpc("release_lifecycle_lock");
        return new Response(
          JSON.stringify({
            error:
              "Your personal legal name is required before you can generate a Proof of Intent. Open Desk → Settings → My Profile and replace the email in the 'Full name' field with your full legal name (e.g. 'Jane Smith'). It will appear as the signatory on the POI.",
            code: "ACTOR_LEGAL_NAME_MISSING",
            remediation_url: "/desk/settings",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

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

    // ── ENGAGEMENT HOLD-POINT GUARD (Batch B Phase 4) ──
    // POI state progression requires the *current* engagement to be
    // `accepted`. We skip this for terminal/cleanup transitions
    // (REJECTED, EXPIRED, ANNULLED) which must remain reachable even when
    // the engagement is in any state. Forward progression
    // (PENDING_APPROVAL / ELIGIBLE / COMPLETION_REQUESTED / COMPLETED)
    // is engagement-scoped and must be blocked when the current
    // engagement is anything other than `accepted`.
    // PENDING_APPROVAL is allowed when no engagement row exists yet (the
    // initial mint can co-create the engagement). Anything past
    // PENDING_APPROVAL strictly requires `current_engagement = accepted`.
    const PROGRESSION_TARGETS = ["PENDING_APPROVAL", "ELIGIBLE", "COMPLETION_REQUESTED", "COMPLETED"];
    if (PROGRESSION_TARGETS.includes(toState)) {
      // Batch C Phase 3A: block progression while a challenge is open/under_review.
      const challengeDecision = await assertNoOpenChallenge(adminClient, matchId);
      if (!challengeDecision.allowed) {
        if (hasLock) await adminClient.rpc("release_lifecycle_lock");
        return challengeOpenResponse(challengeDecision, corsHeaders);
      }

      const decision = await assertEngagementAllowsProgression(adminClient, matchId);
      const allowMissingEngagement =
        toState === "PENDING_APPROVAL" && decision.code === "ENGAGEMENT_REQUIRED";
      if (!decision.allowed && !allowMissingEngagement) {
        if (hasLock) await adminClient.rpc("release_lifecycle_lock");
        return new Response(
          JSON.stringify({
            error: decision.message,
            code: decision.code,
            current_engagement_status: decision.currentStatus,
            has_historical_engagement: decision.hasHistorical,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Block collapse if approvals not complete ──
    if (toState === "COMPLETED") {
      // Phase 1: check that state is COMPLETION_REQUESTED (basic approval gate)
      if (fromState !== "COMPLETION_REQUESTED") {
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

    // ── Batch 1 atomicity: poi_events insert + matches.poi_state update +
    //    audit_logs insert + canonical Governance Record event run in one
    //    DB transaction via atomic_poi_match_transition. If any step (incl.
    //    the governance write) fails, the whole transition rolls back.
    const { data: txResult, error: txErr } = await adminClient.rpc("atomic_poi_match_transition", {
      p_match_id: matchId,
      p_org_id: matchRow.org_id,
      p_from_state: fromState,
      p_to_state: toState,
      p_actor_user_id: user.id,
      p_reason: reason || null,
      p_metadata: metadata || {},
      p_governance: {
        event_type: "poi.state_changed",
        actor_user_id: user.id,
        source_function: "poi-transition",
        request_id: req.headers.get("x-request-id") ?? null,
        correlation_id: req.headers.get("x-correlation-id") ?? null,
        idempotency_key: `${matchId}:${fromState}->${toState}`,
        posture_snapshot: buildPostureSnapshot("Not recorded", {
          policy_version: POI_POLICY_VERSION,
          reason: "posture not derived in poi-transition flow",
        }),
        metadata: { policy_version: POI_POLICY_VERSION },
      },
    });

    if (txErr || !txResult?.success) {
      console.error("CRITICAL: atomic_poi_match_transition failed:", txErr ?? txResult);
      return new Response(
        JSON.stringify({
          error: "POI transition failed atomically — no state change recorded",
          code: "GOV_AUDIT_WRITE_FAILED",
          detail: txErr?.message ?? txResult?.error ?? null,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const event = { id: txResult.event_id, created_at: txResult.created_at };


    const successPayload = {
      success: true,
      event: {
        id: event.id,
        from_state: fromState,
        to_state: toState,
        created_at: event.created_at,
      },
    };
    await storeIdempotentResponse(idemOpts, { status: 200, body: successPayload });
    return new Response(
      JSON.stringify(successPayload),
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
}
