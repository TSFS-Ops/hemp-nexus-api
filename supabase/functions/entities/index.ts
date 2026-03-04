import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Entities Edge Function — V3 Sprint 1
 * 
 * POST: Create entity (INDIVIDUAL or COMPANY)
 * GET:  List entities or get by ID
 * 
 * Follows V3 SuccessEnvelope / ErrorEnvelope contract.
 * Requires Idempotency-Key header on POST.
 */

const EntityCreateSchema = z.object({
  entity_type: z.enum(["INDIVIDUAL", "COMPANY"]),
  legal_name: z.string().min(2).max(256),
  jurisdiction_code: z.string().min(2).max(8),
  registration_number: z.string().nullable().optional(),
  tax_number: z.string().nullable().optional(),
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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organization found", 403);

    const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
    const url = new URL(req.url);

    // ── POST: Create Entity ──
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
        .eq("endpoint", "entities")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const parsed = EntityCreateSchema.parse(body);

      const { data: entity, error } = await admin
        .from("entities")
        .insert({
          org_id: orgId,
          entity_type: parsed.entity_type,
          legal_name: parsed.legal_name,
          jurisdiction_code: parsed.jurisdiction_code,
          registration_number: parsed.registration_number || null,
          tax_number: parsed.tax_number || null,
        })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Record event in event_store
      const eventPayload = JSON.stringify({
        entity_id: entity.id,
        entity_type: parsed.entity_type,
        legal_name: parsed.legal_name,
      });
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(eventPayload));
      const eventHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "trust",
        aggregate_type: "entity",
        aggregate_id: entity.id,
        event_type: "trust.entity.created",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: {
          entity_type: parsed.entity_type,
          legal_name: parsed.legal_name,
          jurisdiction_code: parsed.jurisdiction_code,
        },
        event_hash: eventHash,
      });

      const responseData = successEnvelope(
        {
          entity_id: entity.id,
          entity_type: entity.entity_type,
          legal_name: entity.legal_name,
          jurisdiction_code: entity.jurisdiction_code,
          registration_number: entity.registration_number,
          status: entity.status,
          created_at: entity.created_at,
        },
        correlationId
      );

      // Store idempotency key
      await admin.from("idempotency_keys").insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        endpoint: "entities",
        request_hash: eventHash,
        response_data: responseData,
        response_status_code: 201,
      });

      return new Response(JSON.stringify(responseData), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: List or Get Entity ──
    if (req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");

      if (entityId) {
        const { data: entity, error } = await admin
          .from("entities")
          .select("*")
          .eq("id", entityId)
          .eq("org_id", orgId)
          .maybeSingle();

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
        if (!entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);

        return new Response(
          JSON.stringify(successEnvelope(entity, correlationId)),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // List all entities for org
      const { data: entities, error } = await admin
        .from("entities")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(
        JSON.stringify(successEnvelope(entities || [], correlationId)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(
        "VALIDATION_ERROR",
        err.errors.map((e) => e.message).join(", "),
        400
      );
    }
    if (err instanceof ApiException) {
      return errorResponse(err.code, err.message, err.statusCode);
    }
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "Internal server error", 500);
  }
});
