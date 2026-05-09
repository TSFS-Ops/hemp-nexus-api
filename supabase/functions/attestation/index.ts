import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { assertWadIsSettleable } from "../_shared/test-mode-bypass.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertEngagementAllowsProgression } from "../_shared/engagement-progression-guard.ts";
import { assertNoOpenChallenge } from "../_shared/challenge-progression-guard.ts";

/**
 * Attestations Edge Function
 *
 * POST: Create a director/signatory attestation with signature payload
 * GET:  List attestations for a match/wad/poi
 */

async function sha256(data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation", 403);

    const { actorUserId } = deriveActorIds(authCtx);

    if (req.method === "POST") {
      assertIdempotencyKey(req);
      const body = await req.json();
      const { match_id, wad_id, poi_id, attestation_type, attestation_text, attester_name, attester_role } = body;

      if (!attestation_text || !attester_name || !attester_role) {
        throw new ApiException("VALIDATION_ERROR", "attestation_text, attester_name, attester_role required", 400);
      }

      // Verify attester has director/signatory role
      const allowedRoles = ["director", "signatory", "admin", "platform_admin", "legal_reviewer"];
      const hasRole = authCtx.roles?.some((r: string) => allowedRoles.includes(r));
      if (!hasRole) {
        throw new ApiException("FORBIDDEN", "Only directors, signatories, or admins can create attestations", 403);
      }

      // ── TEST-MODE SETTLEMENT GUARD ──
      // Director sign-off is the irrevocable commercial act on a WaD. If the
      // linked WaD was issued under any test-mode bypass, refuse — the WaD
      // must be re-issued under live conditions before director attestation.
      const effectiveType = attestation_type || "director_sign_off";
      if (wad_id && effectiveType === "director_sign_off") {
        const { data: linkedWad } = await admin
          .from("wads")
          .select("id, evidence_bundle, status")
          .eq("id", wad_id)
          .maybeSingle();

        if (linkedWad) {
          const guard = await assertWadIsSettleable(admin, linkedWad, {
            source: "attestation",
            actorUserId,
            orgId,
            requestId,
            action: "director_sign_off",
          });
          if (guard.blocked) {
            throw new ApiException(
              "TEST_MODE_WAD_NOT_SETTLEABLE",
              `Director sign-off cannot be recorded against a test-mode WaD (gates bypassed: ${guard.bypassedGates.map((b) => b.gate).join(", ")}). Revoke this WaD, disable the relevant test-mode flags, then re-issue under live conditions before attesting.`,
              422,
              { wad_id, bypassed_gates: guard.bypassedGates.map((b) => b.gate) }
            );
          }
        }
      }

      // ── ENGAGEMENT HOLD-POINT GUARD (Batch B Phase 4) ──
      // Director sign-off is the irrevocable commercial act on a WaD;
      // every other attestation type is workflow progression on a match.
      // Block all of them when the current engagement is not accepted.
      if (match_id) {
        // Batch C Phase 2: block attestations while a challenge is open.
        const challengeDecision = await assertNoOpenChallenge(admin, match_id);
        if (!challengeDecision.allowed) {
          throw new ApiException(
            challengeDecision.code!,
            challengeDecision.message!,
            409,
            {
              challenge_id: challengeDecision.challengeId,
              challenge_status: challengeDecision.challengeStatus,
            },
          );
        }

        const decision = await assertEngagementAllowsProgression(admin, match_id);
        if (!decision.allowed) {
          throw new ApiException(
            decision.code!,
            decision.message ?? "Counterparty engagement is not accepted. Attestation blocked.",
            409,
            {
              current_engagement_status: decision.currentStatus,
              has_historical_engagement: decision.hasHistorical,
            },
          );
        }
      }

      // Build canonical signature payload
      const signaturePayload = JSON.stringify({
        attester_user_id: actorUserId,
        attester_name,
        attester_role,
        attestation_type: attestation_type || "director_sign_off",
        attestation_text,
        match_id: match_id || null,
        wad_id: wad_id || null,
        poi_id: poi_id || null,
        org_id: orgId,
        signed_at: new Date().toISOString(),
      });

      const signatureHash = await sha256(signaturePayload);

      const { data: attestation, error } = await admin
        .from("attestations")
        .insert({
          org_id: orgId,
          wad_id: wad_id || null,
          poi_id: poi_id || null,
          match_id: match_id || null,
          attester_user_id: actorUserId,
          attester_role,
          attester_name,
          attestation_type: attestation_type || "director_sign_off",
          attestation_text,
          signature_payload: signaturePayload,
          signature_hash: signatureHash,
          metadata: body.metadata || {},
        })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Audit log
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: actorUserId,
        action: "attestation.created",
        entity_type: "attestation",
        entity_id: attestation.id,
        metadata: {
          attestation_type: attestation.attestation_type,
          signature_hash: signatureHash,
          match_id, wad_id, poi_id,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        attestation,
        signature_hash: signatureHash,
      }), { status: 201, headers: { ...headers, "Content-Type": "application/json" } });
    }

    if (req.method === "GET") {
      const url = new URL(req.url);
      const matchId = url.searchParams.get("match_id");
      const wadId = url.searchParams.get("wad_id");
      const poiId = url.searchParams.get("poi_id");

      let query = admin.from("attestations").select("*").eq("org_id", orgId).order("signed_at", { ascending: false });

      if (matchId) query = query.eq("match_id", matchId);
      if (wadId) query = query.eq("wad_id", wadId);
      if (poiId) query = query.eq("poi_id", poiId);

      const { data, error } = await query.limit(100);
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify({ success: true, attestations: data || [] }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Use GET or POST", 405);
  } catch (err) {
    console.error(`[${requestId}] Attestation error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
