import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Interests Edge Function — V3 Sprint 2
 *
 * POST: Declare interest from one entity to another (30-day expiry).
 *       Automatically detects mutual interest when reciprocal exists.
 * GET:  List interests for org, optionally filter by entity_id.
 *
 * Follows V3 SuccessEnvelope / ErrorEnvelope contract.
 */

const INTEREST_EXPIRY_DAYS = 30;

const InterestCreateSchema = z.object({
  from_entity_id: z.string().uuid(),
  to_entity_id: z.string().uuid(),
  context: z.string().max(1024).nullable().optional(),
});

function successEnvelope(data: unknown, correlationId: string) {
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
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

    // ── POST: Declare Interest ──
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
        .eq("endpoint", "interests")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const parsed = InterestCreateSchema.parse(body);

      if (parsed.from_entity_id === parsed.to_entity_id) {
        throw new ApiException("VALIDATION_ERROR", "Cannot declare interest to the same entity", 400);
      }

      // Verify both entities belong to same org or exist
      const { data: fromEntity } = await admin
        .from("entities")
        .select("id, org_id")
        .eq("id", parsed.from_entity_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!fromEntity) {
        throw new ApiException("NOT_FOUND", "From entity not found or not in your organisation", 404);
      }

      // To entity can be in any org (cross-org interest)
      const { data: toEntity } = await admin
        .from("entities")
        .select("id, org_id")
        .eq("id", parsed.to_entity_id)
        .maybeSingle();

      if (!toEntity) {
        throw new ApiException("NOT_FOUND", "To entity not found", 404);
      }

      // Check for existing active interest (prevent duplicates)
      const { data: existingInterest } = await admin
        .from("interests")
        .select("id")
        .eq("from_entity_id", parsed.from_entity_id)
        .eq("to_entity_id", parsed.to_entity_id)
        .eq("org_id", orgId)
        .eq("status", "active")
        .maybeSingle();

      if (existingInterest) {
        throw new ApiException("CONFLICT", "Active interest already exists between these entities", 409);
      }

      // Create interest
      const { data: interest, error } = await admin
        .from("interests")
        .insert({
          org_id: orgId,
          from_entity_id: parsed.from_entity_id,
          to_entity_id: parsed.to_entity_id,
          context: parsed.context || null,
          status: "active",
        })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Record event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "trust",
        aggregate_type: "interest",
        aggregate_id: interest.id,
        event_type: "trust.interest.declared",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: {
          from_entity_id: parsed.from_entity_id,
          to_entity_id: parsed.to_entity_id,
        },
        event_hash: await computeHash(JSON.stringify({
          from: parsed.from_entity_id,
          to: parsed.to_entity_id,
          ts: new Date().toISOString(),
        })),
      });

      // ── Mutual Interest Detection ──
      // Check if the reverse interest exists (to→from)
      let mutualInterest = null;
      const { data: reciprocal } = await admin
        .from("interests")
        .select("id, org_id")
        .eq("from_entity_id", parsed.to_entity_id)
        .eq("to_entity_id", parsed.from_entity_id)
        .eq("status", "active")
        .maybeSingle();

      if (reciprocal) {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + INTEREST_EXPIRY_DAYS);

        // Ensure entity_a < entity_b for canonical ordering
        const [entityA, entityB] = [parsed.from_entity_id, parsed.to_entity_id].sort();

        // Check if mutual interest already exists
        const { data: existingMutual } = await admin
          .from("mutual_interests")
          .select("id")
          .eq("entity_a", entityA)
          .eq("entity_b", entityB)
          .eq("status", "active")
          .maybeSingle();

        if (!existingMutual) {
          const { data: mi, error: miError } = await admin
            .from("mutual_interests")
            .insert({
              org_id: orgId,
              entity_a: entityA,
              entity_b: entityB,
              expires_at: expiresAt.toISOString(),
              status: "active",
            })
            .select()
            .single();

          if (!miError && mi) {
            mutualInterest = mi;

            // Record mutual interest event
            await admin.from("event_store").insert({
              org_id: orgId,
              domain: "trust",
              aggregate_type: "mutual_interest",
              aggregate_id: mi.id,
              event_type: "trust.mutual_interest.formed",
              actor_id: authCtx.isApiKey ? null : authCtx.userId,
              actor_role: authCtx.roles?.[0] || null,
              payload: { entity_a: entityA, entity_b: entityB, expires_at: expiresAt.toISOString() },
              event_hash: await computeHash(JSON.stringify({ a: entityA, b: entityB })),
            });
          }
        }
      }

      const responseData = successEnvelope(
        {
          interest_id: interest.id,
          from_entity_id: interest.from_entity_id,
          to_entity_id: interest.to_entity_id,
          status: interest.status,
          created_at: interest.created_at,
          mutual_interest: mutualInterest
            ? {
                mutual_interest_id: mutualInterest.id,
                entity_a: mutualInterest.entity_a,
                entity_b: mutualInterest.entity_b,
                expires_at: mutualInterest.expires_at,
              }
            : null,
        },
        correlationId
      );

      // Store idempotency key
      await admin.from("idempotency_keys").insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        endpoint: "interests",
        request_hash: await computeHash(JSON.stringify(parsed)),
        response_data: responseData,
        response_status_code: 201,
      });

      return new Response(JSON.stringify(responseData), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: List Interests ──
    if (req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");
      const status = url.searchParams.get("status") || "active";

      let query = admin
        .from("interests")
        .select("*")
        .eq("org_id", orgId)
        .eq("status", status)
        .order("created_at", { ascending: false })
        .limit(100);

      if (entityId) {
        query = query.or(`from_entity_id.eq.${entityId},to_entity_id.eq.${entityId}`);
      }

      const { data: interests, error } = await query;
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Also fetch mutual interests for this org
      const { data: mutualInterests } = await admin
        .from("mutual_interests")
        .select("*")
        .eq("org_id", orgId)
        .eq("status", "active")
        .order("formed_at", { ascending: false })
        .limit(100);

      return new Response(
        JSON.stringify(
          successEnvelope({ interests: interests || [], mutual_interests: mutualInterests || [] }, correlationId)
        ),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
