import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  checkOrgLegitimacy,
  getActiveGovernanceProfile,
  ORG_NOT_VERIFIED_CODE,
} from "../_shared/legitimacy.ts";
import { tryBypass } from "../_shared/test-mode-bypass.ts";
import {
  buildPostureSnapshot,
  writeCriticalEventWithPosture,
} from "../_shared/governance-audit-integration.ts";
import { POI_POLICY_VERSION } from "../_shared/governance-policy-versions.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * POI (Trade Request) Edge Function - V3 Sprint 2
 *
 * POST: Issue a new POI. Supports both bilateral and unilateral types.
 * GET:  List POIs or get by ID.
 * PATCH: Transition Intent state (deterministic state machine).
 *
 * Hardened for burst traffic:
 * - Per-method rate limiting (pois:write, pois:read, pois:transition)
 * - Parallel entity verification (bilateral path)
 * - Retry-After headers on 429s
 */

const MIN_PROBABILITY = 0.501; // ≥50.1%

const VALID_STATES = [
  "DRAFT",
  "PENDING_APPROVAL",
  "ELIGIBLE",
  "COMPLETION_REQUESTED",
  "COMPLETED",
  "EXPIRED",
  "ANNULLED",
  "REJECTED",
] as const;

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

/** Unilateral POIs may not advance past ELIGIBLE */
const UNILATERAL_STATE_CAP = "ELIGIBLE";
const PAST_CAP_STATES = ["COMPLETION_REQUESTED", "COMPLETED"];

// ── Validation Schemas ──

/** Bilateral POI creation (existing, unchanged) */
const PoiCreateBilateralSchema = z.object({
  poi_type: z.literal("bilateral").default("bilateral"),
  buyer_entity_id: z.string().uuid(),
  seller_entity_id: z.string().uuid(),
  jurisdiction_code: z.string().min(2).max(8),
  industry_code: z.string().min(2).max(16),
  completion_probability: z.number().min(0).max(1),
  terms: z.record(z.unknown()).optional(),
});

/** Unilateral POI creation (new, additive) */
const PoiCreateUnilateralSchema = z.object({
  poi_type: z.literal("unilateral"),
  buyer_entity_id: z.string().uuid(),
  jurisdiction_code: z.string().min(2).max(8),
  industry_code: z.string().min(2).max(16),
  terms: z.record(z.unknown()).optional(),
});

/** Discriminated union — routes to the right schema based on poi_type */
const PoiCreateSchema = z.discriminatedUnion("poi_type", [
  PoiCreateBilateralSchema,
  PoiCreateUnilateralSchema,
]);

const PoiTransitionSchema = z.object({
  poi_id: z.string().uuid(),
  to_state: z.enum(VALID_STATES),
  reason: z.string().max(512).optional(),
});

function successEnvelope(data: unknown, correlationId: string, dealState?: string) {
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    ...(dealState ? { deal_state: dealState } : {}),
    data,
  };
}

function errorResponse(code: string, message: string, statusCode: number, correlationId: string, retryAfter?: number) {
  const headers: Record<string, string> = { ...corsHeaders, "Content-Type": "application/json" };
  if (retryAfter) {
    headers["Retry-After"] = retryAfter.toString();
  }
  return new Response(
    JSON.stringify({
      status: "ERROR",
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
      error: { code, message },
    }),
    { status: statusCode, headers }
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    const url = new URL(req.url);

    // ── POST: Issue POI ──
    if (req.method === "POST") {
      // Rate limit BEFORE any DB work
      await checkRateLimit(admin, orgId, null, "pois", "pois:write");

      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header is required", 400);
      }

      // Idempotency check
      const { data: existing } = await admin
        .from("idempotency_keys")
        .select("response_data, response_status_code")
        .eq("org_id", orgId)
        .eq("idempotency_key", idempotencyKey)
        .eq("endpoint", "pois")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();

      // Default poi_type to 'bilateral' for backward compatibility
      if (!body.poi_type) {
        body.poi_type = "bilateral";
      }

      const parsed = PoiCreateSchema.parse(body);

      // ── LEGITIMACY GATE (mirror of match/index.ts) ──
      // Mint paths in this function bypass the `match` edge function and so
      // bypassed the legitimacy check until now. An unverified org could mint
      // a POI directly via this endpoint despite the UI alert in
      // StateProgressionCard claiming "Verification required". This gate
      // restores symmetry: the server now enforces the same rule the client
      // shows. Runs BEFORE the handler so no `pois` row, `event_store` row,
      // or `idempotency_keys` row is written for a blocked attempt.
      const governanceProfile = await getActiveGovernanceProfile(admin, orgId);
      const legitimacy = await checkOrgLegitimacy(admin, orgId, "poi_mint");
      if (!legitimacy.allowed) {
        // Test-mode bypass: admin-controlled "kyb" flag short-circuits the
        // legitimacy gate so unverified orgs can still mint POIs in non-prod
        // environments. Production tier is locked out inside tryBypass.
        const bypassed = await tryBypass(admin, {
          gate: "kyb",
          source: "pois",
          orgId,
          actorUserId: authCtx.isApiKey ? null : authCtx.userId,
          requestId: correlationId,
          details: {
            callsite: "poi_mint",
            poi_type: parsed.poi_type,
            legitimacy_reason: legitimacy.reason,
            gate_position: legitimacy.gatePosition,
          },
        });
        if (!bypassed) {
          console.warn(
            `[${correlationId}] LEGITIMACY_GATE_BLOCKED endpoint=pois poi_type=${parsed.poi_type} reason=${legitimacy.reason} status=${legitimacy.status} gate_position=${legitimacy.gatePosition} org_id=${orgId}`,
          );
          try {
            await admin.from("audit_logs").insert({
              org_id: orgId,
              actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
              action: "poi.mint_denied",
              entity_type: "poi",
              entity_id: null,
              metadata: {
                correlation_id: correlationId,
                endpoint: "pois",
                actor_is_api_key: authCtx.isApiKey,
                poi_type: parsed.poi_type,
                reason: "org_not_verified",
                legitimacy_reason: legitimacy.reason,
                trade_approval_status: legitimacy.status,
                valid_until: legitimacy.validUntil,
                gate_position: legitimacy.gatePosition,
                governance_profile_id: governanceProfile.profileId,
              },
            });
          } catch (auditErr) {
            console.error(`[${correlationId}] Failed to write legitimacy denial audit row:`, auditErr);
          }
          throw new ApiException(ORG_NOT_VERIFIED_CODE, legitimacy.message, 403);
        }
      }

      if (parsed.poi_type === "bilateral") {
        return await handleBilateralCreate(admin, orgId, parsed, authCtx, idempotencyKey, correlationId);
      } else {
        return await handleUnilateralCreate(admin, orgId, parsed, authCtx, idempotencyKey, correlationId);
      }
    }

    // ── PATCH: Transition POI State ──
    if (req.method === "PATCH") {
      await checkRateLimit(admin, orgId, null, "pois", "pois:transition");

      const body = await req.json();
      const parsed = PoiTransitionSchema.parse(body);

      // Fetch current POI
      const { data: poi, error: fetchErr } = await admin
        .from("pois")
        .select("*")
        .eq("id", parsed.poi_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (fetchErr) throw new ApiException("INTERNAL_ERROR", fetchErr.message, 500);
      if (!poi) throw new ApiException("NOT_FOUND", "POI not found", 404);

      const fromState = poi.state;
      const toState = parsed.to_state;

      // Validate transition
      if (fromState === toState) {
        throw new ApiException("VALIDATION_ERROR", `Cannot transition to the same state: ${fromState}`, 400);
      }

      const allowed = VALID_TRANSITIONS[fromState];
      if (!allowed || !allowed.includes(toState)) {
        throw new ApiException(
          "INVALID_TRANSITION",
          `Transition from ${fromState} to ${toState} is not permitted. Valid: [${(allowed || []).join(", ")}]`,
          422
        );
      }

      // ── Unilateral cap guard (additive, does not affect bilateral) ──
      if (poi.poi_type === "unilateral" && PAST_CAP_STATES.includes(toState)) {
        throw new ApiException(
          "UNILATERAL_CAP",
          `Unilateral POIs cannot transition to ${toState}. A counterparty is required for execution stages. Maximum reachable state: ${UNILATERAL_STATE_CAP}`,
          422
        );
      }

      // ── Batch 1 atomicity: pois.update + legacy event_store + Governance Record
      //    are written in one DB transaction via atomic_pois_transition. The
      //    post-RPC TS critical writer is no longer invoked on the happy path.
      const legacyHash = await computeHash(JSON.stringify({ poi_id: poi.id, from: fromState, to: toState }));
      const { data: txResult, error: txErr } = await admin.rpc("atomic_pois_transition", {
        p_poi_id: parsed.poi_id,
        p_org_id: orgId,
        p_to_state: toState,
        p_actor_user_id: authCtx.isApiKey ? null : (authCtx.userId ?? null),
        p_actor_role: authCtx.roles?.[0] || null,
        p_actor_api_key_id: null,
        p_reason: parsed.reason || null,
        p_legacy_event_hash: legacyHash,
        p_governance: {
          event_type: "poi.state_changed",
          actor_user_id: authCtx.isApiKey ? null : (authCtx.userId ?? null),
          actor_role: authCtx.roles?.[0] || null,
          source_function: "pois",
          correlation_id: correlationId,
          idempotency_key: `${parsed.poi_id}:${fromState}->${toState}`,
          posture_snapshot: buildPostureSnapshot("Not recorded", {
            policy_version: POI_POLICY_VERSION,
            reason: "posture not derived in pois transition flow",
          }),
          metadata: { poi_type: poi.poi_type, policy_version: POI_POLICY_VERSION },
        },
      });

      if (txErr || !txResult?.success) {
        throw new ApiException(
          "GOV_AUDIT_WRITE_FAILED",
          `POI transition atomic RPC failed: ${txErr?.message ?? txResult?.error ?? "unknown"}`,
          500
        );
      }

      const updated = {
        id: txResult.poi_id,
        poi_type: txResult.poi_type,
        state: txResult.current_state,
        last_activity_at: txResult.transitioned_at,
      };




      return new Response(
        JSON.stringify(
          successEnvelope(
            {
              poi_id: updated.id,
              poi_type: updated.poi_type,
              previous_state: fromState,
              current_state: updated.state,
              transitioned_at: updated.last_activity_at,
            },
            correlationId,
            updated.state
          )
        ),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── GET: List / Get POIs ──
    if (req.method === "GET") {
      await checkRateLimit(admin, orgId, null, "pois", "pois:read");

      const poiId = url.searchParams.get("poi_id");

      if (poiId) {
        const { data: poi, error } = await admin
          .from("pois")
          .select("*")
          .eq("id", poiId)
          .eq("org_id", orgId)
          .maybeSingle();

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
        if (!poi) throw new ApiException("NOT_FOUND", "POI not found", 404);

        return new Response(JSON.stringify(successEnvelope(poi, correlationId, poi.state)), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const stateFilter = url.searchParams.get("state");
      const typeFilter = url.searchParams.get("poi_type");
      let query = admin
        .from("pois")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (stateFilter) {
        query = query.eq("state", stateFilter);
      }
      if (typeFilter) {
        query = query.eq("poi_type", typeFilter);
      }

      const { data: pois, error } = await query;
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify(successEnvelope(pois || [], correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse("VALIDATION_ERROR", err.errors.map((e) => e.message).join(", "), 400, correlationId);
    }
    if (err instanceof ApiException) {
      const retryAfter = err.statusCode === 429 ? (err.details as { retryAfter?: number })?.retryAfter : undefined;
      return errorResponse(err.code, err.message, err.statusCode, correlationId, retryAfter);
    }
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500, correlationId);
  }
});

// ── Bilateral POI Creation (existing logic, with parallel entity check) ──
async function handleBilateralCreate(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  parsed: z.infer<typeof PoiCreateBilateralSchema>,
  authCtx: { isApiKey?: boolean; userId?: string; roles?: string[] },
  idempotencyKey: string,
  correlationId: string
) {
  // ── Guard: probability threshold ──
  if (parsed.completion_probability < MIN_PROBABILITY) {
    throw new ApiException(
      "PROBABILITY_BELOW_THRESHOLD",
      `Completion probability must be ≥${MIN_PROBABILITY * 100}%. Got ${(parsed.completion_probability * 100).toFixed(1)}%.`,
      422
    );
  }

  // ── Parallel: mutual interest + entity verification (3 queries → 1 round trip) ──
  const [entityA, entityB] = [parsed.buyer_entity_id, parsed.seller_entity_id].sort();
  const [mutualInterestResult, buyerResult, sellerResult] = await Promise.all([
    admin
      .from("mutual_interests")
      .select("id, status, expires_at")
      .eq("entity_a", entityA)
      .eq("entity_b", entityB)
      .eq("status", "active")
      .maybeSingle(),
    admin.from("entities").select("id").eq("id", parsed.buyer_entity_id).maybeSingle(),
    admin.from("entities").select("id").eq("id", parsed.seller_entity_id).maybeSingle(),
  ]);

  if (!mutualInterestResult.data) {
    throw new ApiException(
      "PRECONDITION_FAILED",
      "Active mutual interest between buyer and seller is required before POI issuance",
      412
    );
  }

  if (new Date(mutualInterestResult.data.expires_at) < new Date()) {
    throw new ApiException(
      "PRECONDITION_FAILED",
      "Mutual interest has expired. Parties must re-declare interest.",
      412
    );
  }

  if (!buyerResult.data) throw new ApiException("NOT_FOUND", "Buyer entity not found", 404);
  if (!sellerResult.data) throw new ApiException("NOT_FOUND", "Seller entity not found", 404);

  // Batch 1 atomicity: pois.insert + legacy event_store + idempotency_keys
  // + Governance Record in a single DB transaction.
  const eventHash = await computeHash(JSON.stringify({ buyer: parsed.buyer_entity_id, seller: parsed.seller_entity_id, ts: new Date().toISOString() }));
  const requestHash = await computeHash(JSON.stringify(parsed));

  // We need the response shape before the RPC writes the idempotency row,
  // so build it from the request + a placeholder id, then patch the id in.
  const responseShellPre = successEnvelope(
    {
      poi_id: "00000000-0000-0000-0000-000000000000",
      poi_type: "bilateral",
      state: "DRAFT",
      buyer_entity_id: parsed.buyer_entity_id,
      seller_entity_id: parsed.seller_entity_id,
      completion_probability: parsed.completion_probability,
      jurisdiction_code: parsed.jurisdiction_code,
      industry_code: parsed.industry_code,
      created_at: null,
    },
    correlationId,
    "DRAFT"
  );

  const { data: createRes, error: createErr } = await admin.rpc("atomic_pois_create", {
    p_org_id: orgId,
    p_poi_type: "bilateral",
    p_buyer_entity_id: parsed.buyer_entity_id,
    p_seller_entity_id: parsed.seller_entity_id,
    p_jurisdiction_code: parsed.jurisdiction_code,
    p_industry_code: parsed.industry_code,
    p_completion_probability: parsed.completion_probability,
    p_terms: parsed.terms || {},
    p_actor_user_id: authCtx.isApiKey ? null : (authCtx.userId ?? null),
    p_actor_role: authCtx.roles?.[0] || null,
    p_idempotency_key: idempotencyKey,
    p_idempotency_request_hash: requestHash,
    p_idempotency_response: responseShellPre,
    p_idempotency_status: 201,
    p_legacy_event_type: "trust.poi.issued",
    p_legacy_event_hash: eventHash,
    p_legacy_event_payload: {
      poi_type: "bilateral",
      buyer_entity_id: parsed.buyer_entity_id,
      seller_entity_id: parsed.seller_entity_id,
      completion_probability: parsed.completion_probability,
      mutual_interest_id: mutualInterestResult.data.id,
    },
    p_governance: {
      event_type: "poi.created",
      actor_user_id: authCtx.isApiKey ? null : (authCtx.userId ?? null),
      actor_role: authCtx.roles?.[0] || null,
      source_function: "pois",
      correlation_id: correlationId,
      idempotency_key: idempotencyKey,
      posture_snapshot: buildPostureSnapshot("Not recorded", {
        policy_version: POI_POLICY_VERSION,
        reason: "posture not derived in pois bilateral create",
      }),
      metadata: {
        poi_type: "bilateral",
        jurisdiction_code: parsed.jurisdiction_code,
        industry_code: parsed.industry_code,
        completion_probability: parsed.completion_probability,
        policy_version: POI_POLICY_VERSION,
      },
    },
  });

  if (createErr || !createRes?.success) {
    throw new ApiException(
      "INTERNAL_ERROR",
      `POI create atomic RPC failed: ${createErr?.message ?? createRes?.error ?? "unknown"}`,
      500
    );
  }

  const responseData = successEnvelope(
    {
      poi_id: createRes.poi_id,
      poi_type: createRes.poi_type,
      state: createRes.state,
      buyer_entity_id: createRes.buyer_entity_id,
      seller_entity_id: createRes.seller_entity_id,
      completion_probability: createRes.completion_probability,
      jurisdiction_code: createRes.jurisdiction_code,
      industry_code: createRes.industry_code,
      created_at: createRes.created_at,
    },
    correlationId,
    createRes.state
  );



  return new Response(JSON.stringify(responseData), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Unilateral POI Creation (new, additive) ──
async function handleUnilateralCreate(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  parsed: z.infer<typeof PoiCreateUnilateralSchema>,
  authCtx: { isApiKey?: boolean; userId?: string; roles?: string[] },
  idempotencyKey: string,
  correlationId: string
) {
  // Verify declaring entity exists
  const { data: buyer } = await admin.from("entities").select("id").eq("id", parsed.buyer_entity_id).maybeSingle();
  if (!buyer) throw new ApiException("NOT_FOUND", "Declaring entity not found", 404);

  const { data: poi, error } = await admin
    .from("pois")
    .insert({
      org_id: orgId,
      poi_type: "unilateral",
      buyer_entity_id: parsed.buyer_entity_id,
      seller_entity_id: null,
      jurisdiction_code: parsed.jurisdiction_code,
      industry_code: parsed.industry_code,
      completion_probability: null,
      terms: parsed.terms || {},
      state: "DRAFT",
    })
    .select()
    .single();

  if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

  const eventHash = await computeHash(JSON.stringify({ poi_id: poi.id, ts: new Date().toISOString() }));
  const requestHash = await computeHash(JSON.stringify(parsed));

  const responseData = successEnvelope(
    {
      poi_id: poi.id,
      poi_type: poi.poi_type,
      state: poi.state,
      buyer_entity_id: poi.buyer_entity_id,
      seller_entity_id: null,
      completion_probability: null,
      jurisdiction_code: poi.jurisdiction_code,
      industry_code: poi.industry_code,
      created_at: poi.created_at,
      unilateral_state_cap: "ELIGIBLE",
    },
    correlationId,
    poi.state
  );

  // Fire both writes in parallel
  await Promise.all([
    admin.from("event_store").insert({
      org_id: orgId,
      domain: "trust",
      aggregate_type: "poi",
      aggregate_id: poi.id,
      event_type: "trust.poi.issued.unilateral",
      actor_id: authCtx.isApiKey ? null : authCtx.userId,
      actor_role: authCtx.roles?.[0] || null,
      payload: {
        poi_type: "unilateral",
        buyer_entity_id: parsed.buyer_entity_id,
        jurisdiction_code: parsed.jurisdiction_code,
        industry_code: parsed.industry_code,
      },
      event_hash: eventHash,
    }),
    admin.from("idempotency_keys").insert({
      org_id: orgId,
      idempotency_key: idempotencyKey,
      endpoint: "pois",
      request_hash: requestHash,
      response_data: responseData,
      response_status_code: 201,
    }),
  ]);

  // Phase 2 canonical governance event (fail-closed)
  await writeCriticalEventWithPosture(admin, {
    event_type: "poi.created",
    org_id: orgId,
    aggregate_type: "poi",
    aggregate_id: poi.id,
    actor_user_id: authCtx.isApiKey ? null : (authCtx.userId ?? null),
    actor_role: authCtx.roles?.[0] || null,
    source_function: "pois",
    correlation_id: correlationId,
    poi_id: poi.id,
    new_state: poi.state,
    allowed_or_blocked: "allowed",
    posture: buildPostureSnapshot("Not recorded", {
      policy_version: POI_POLICY_VERSION,
      reason: "posture not derived in pois unilateral create",
    }),
    metadata: {
      poi_type: "unilateral",
      jurisdiction_code: parsed.jurisdiction_code,
      industry_code: parsed.industry_code,
      policy_version: POI_POLICY_VERSION,
    },
    idempotency_extra: idempotencyKey,
  });


  return new Response(JSON.stringify(responseData), {
    status: 201,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
