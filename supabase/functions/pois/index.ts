import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * POI (Trade Request) Edge Function - V3 Sprint 2
 *
 * POST: Issue a new POI. Supports both bilateral and unilateral types.
 * GET:  List POIs or get by ID.
 * PATCH: Transition Intent state (deterministic state machine).
 *
 * Follows V3 SuccessEnvelope / ErrorEnvelope contract.
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

const IMMUTABLE_STATES = ["COMPLETED", "ANNULLED", "EXPIRED", "REJECTED"];

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

      if (parsed.poi_type === "bilateral") {
        return await handleBilateralCreate(admin, orgId, parsed, authCtx, idempotencyKey, correlationId);
      } else {
        return await handleUnilateralCreate(admin, orgId, parsed, authCtx, idempotencyKey, correlationId);
      }
    }

    // ── PATCH: Transition POI State ──
    if (req.method === "PATCH") {
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

      // Update Intent state
      const { data: updated, error: updateErr } = await admin
        .from("pois")
        .update({ state: toState, last_activity_at: new Date().toISOString() })
        .eq("id", parsed.poi_id)
        .select()
        .single();

      if (updateErr) throw new ApiException("INTERNAL_ERROR", updateErr.message, 500);

      // Record transition event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "trust",
        aggregate_type: "poi",
        aggregate_id: poi.id,
        event_type: `trust.poi.transitioned`,
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: {
          from_state: fromState,
          to_state: toState,
          reason: parsed.reason || null,
          poi_type: poi.poi_type,
        },
        event_hash: await computeHash(JSON.stringify({ poi_id: poi.id, from: fromState, to: toState })),
      });

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
      return new Response(
        JSON.stringify({
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: { code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") },
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (err instanceof ApiException) {
      return new Response(
        JSON.stringify({
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: { code: err.code, message: err.message },
        }),
        { status: err.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({
        status: "ERROR",
        timestamp: new Date().toISOString(),
        correlation_id: correlationId,
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ── Bilateral POI Creation (existing logic, extracted into function) ──
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

  // ── Guard: mutual interest must exist ──
  const [entityA, entityB] = [parsed.buyer_entity_id, parsed.seller_entity_id].sort();
  const { data: mutualInterest } = await admin
    .from("mutual_interests")
    .select("id, status, expires_at")
    .eq("entity_a", entityA)
    .eq("entity_b", entityB)
    .eq("status", "active")
    .maybeSingle();

  if (!mutualInterest) {
    throw new ApiException(
      "PRECONDITION_FAILED",
      "Active mutual interest between buyer and seller is required before POI issuance",
      412
    );
  }

  // Check expiry
  if (new Date(mutualInterest.expires_at) < new Date()) {
    throw new ApiException(
      "PRECONDITION_FAILED",
      "Mutual interest has expired. Parties must re-declare interest.",
      412
    );
  }

  // Verify entities exist
  const { data: buyer } = await admin.from("entities").select("id").eq("id", parsed.buyer_entity_id).maybeSingle();
  const { data: seller } = await admin.from("entities").select("id").eq("id", parsed.seller_entity_id).maybeSingle();

  if (!buyer) throw new ApiException("NOT_FOUND", "Buyer entity not found", 404);
  if (!seller) throw new ApiException("NOT_FOUND", "Seller entity not found", 404);

  // Draft Request in DRAFT state
  const { data: poi, error } = await admin
    .from("pois")
    .insert({
      org_id: orgId,
      poi_type: "bilateral",
      buyer_entity_id: parsed.buyer_entity_id,
      seller_entity_id: parsed.seller_entity_id,
      jurisdiction_code: parsed.jurisdiction_code,
      industry_code: parsed.industry_code,
      completion_probability: parsed.completion_probability,
      terms: parsed.terms || {},
      state: "DRAFT",
    })
    .select()
    .single();

  if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

  // Record event
  await admin.from("event_store").insert({
    org_id: orgId,
    domain: "trust",
    aggregate_type: "poi",
    aggregate_id: poi.id,
    event_type: "trust.poi.issued",
    actor_id: authCtx.isApiKey ? null : authCtx.userId,
    actor_role: authCtx.roles?.[0] || null,
    payload: {
      poi_type: "bilateral",
      buyer_entity_id: parsed.buyer_entity_id,
      seller_entity_id: parsed.seller_entity_id,
      completion_probability: parsed.completion_probability,
      mutual_interest_id: mutualInterest.id,
    },
    event_hash: await computeHash(JSON.stringify({ poi_id: poi.id, ts: new Date().toISOString() })),
  });

  const responseData = successEnvelope(
    {
      poi_id: poi.id,
      poi_type: poi.poi_type,
      state: poi.state,
      buyer_entity_id: poi.buyer_entity_id,
      seller_entity_id: poi.seller_entity_id,
      completion_probability: poi.completion_probability,
      jurisdiction_code: poi.jurisdiction_code,
      industry_code: poi.industry_code,
      created_at: poi.created_at,
    },
    correlationId,
    poi.state
  );

  await admin.from("idempotency_keys").insert({
    org_id: orgId,
    idempotency_key: idempotencyKey,
    endpoint: "pois",
    request_hash: await computeHash(JSON.stringify(parsed)),
    response_data: responseData,
    response_status_code: 201,
  });

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

  // No mutual interest check — this is a standalone declaration
  // No probability threshold — not applicable without a counterparty

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

  // Record event
  await admin.from("event_store").insert({
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
    event_hash: await computeHash(JSON.stringify({ poi_id: poi.id, ts: new Date().toISOString() })),
  });

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

  await admin.from("idempotency_keys").insert({
    org_id: orgId,
    idempotency_key: idempotencyKey,
    endpoint: "pois",
    request_hash: await computeHash(JSON.stringify(parsed)),
    response_data: responseData,
    response_status_code: 201,
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
