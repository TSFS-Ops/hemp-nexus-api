import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Entities Edge Function - V3 Sprint 5
 *
 * POST:   Create entity (INDIVIDUAL or COMPANY)
 * GET:    List entities or get by ID (org-scoped or admin cross-org)
 * PATCH:  Update entity status / screening result (admin only)
 * DELETE: Soft-delete entity (admin only)
 *
 * Supports both API-key and JWT auth.
 * Requires Idempotency-Key header on POST.
 */

const EntityCreateSchema = z.object({
  entity_type: z.enum(["INDIVIDUAL", "COMPANY"]),
  legal_name: z.string().min(2).max(256),
  jurisdiction_code: z.string().min(2).max(8),
  registration_number: z.string().nullable().optional(),
  tax_number: z.string().nullable().optional(),
});

const EntityUpdateSchema = z.object({
  status: z.enum(["active", "suspended", "blocked", "archived"]).optional(),
  legal_name: z.string().min(2).max(256).optional(),
  registration_number: z.string().nullable().optional(),
  tax_number: z.string().nullable().optional(),
});

const ScreeningResultSchema = z.object({
  entity_id: z.string().uuid(),
  provider: z.string().max(100).default("stub"),
  result: z.enum(["clear", "match", "review"]),
  details: z.record(z.unknown()).optional(),
});

function successEnvelope(data: unknown, correlationId: string, meta?: Record<string, unknown>) {
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    ...meta,
    data,
  };
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    // ── Server-side governance role enforcement ──
    // Entity records (KYB/KYC subjects) are governance-scoped data. Only
    // governance principals may read or mutate them. This mirrors the SPA
    // route guard so direct API calls cannot bypass it.
    // Tightened to match SPA route guard exactly. See governance-docs for rationale.
    const GOVERNANCE_ROLES_E = ["platform_admin", "auditor", "org_admin"];
    const GOVERNANCE_SCOPES_E = ["entities", "entities:read", "entities:write", "governance"];
    const callerRolesE = authCtx.roles || [];
    const isGovernancePrincipalE = authCtx.isApiKey
      ? callerRolesE.some((r) => GOVERNANCE_SCOPES_E.includes(r) || r.startsWith("entities:") || r.startsWith("governance:"))
      : callerRolesE.some((r) => GOVERNANCE_ROLES_E.includes(r));
    if (!isGovernancePrincipalE) {
      throw new ApiException(
        "FORBIDDEN",
        "Governance role required (platform_admin, auditor, org_admin, or compliance role)",
        403,
      );
    }

    const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    // pathParts: ["entities"] or ["entities", "<sub>"]

    const isAdmin = authCtx.roles?.includes("admin") || authCtx.roles?.includes("platform_admin");
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorisation");

    // SEC-001 helper: gate platform_admin mutations with AAL2 (MFA). API keys
    // (server-to-server) have no `aal` claim; skip there so machine flows keep
    // working. Non-admin governance users (own-org create/update) also remain
    // AAL1 — this only blocks cross-org platform_admin overrides.
    const requireMfaForPlatformAdmin = async (action: string, target?: { id?: string; type?: string }) => {
      if (authCtx.isApiKey) return;
      if (!isAdmin) return;
      await assertAal2(authHeader, {
        adminClient: admin,
        callerUserId: authCtx.userId,
        action,
        context: {
          sensitive_action_category: "governance.entity",
          target_resource_type: target?.type ?? "entity",
          target_resource_id: target?.id ?? null,
          method: req.method,
          path: pathParts.join("/"),
        },
      });
    };

    // ── POST /entities ── Create Entity
    if (req.method === "POST" && pathParts.length <= 1) {
      await requireMfaForPlatformAdmin("entity.mutate");
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

      const eventHash = await sha256(JSON.stringify({ entity_id: entity.id, entity_type: parsed.entity_type, legal_name: parsed.legal_name }));

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

    // ── POST /entities/screen ── Screening stub (admin only)
    if (req.method === "POST" && pathParts[pathParts.length - 1] === "screen") {
      requireRole(authCtx, "platform_admin");
      await requireMfaForPlatformAdmin("entity.mutate", { type: "entity.screen" });
      assertIdempotencyKey(req);

      const body = await req.json();
      const parsed = ScreeningResultSchema.parse(body);

      // Verify entity exists
      const { data: entity, error: entErr } = await admin
        .from("entities")
        .select("id, legal_name, org_id")
        .eq("id", parsed.entity_id)
        .maybeSingle();

      if (entErr || !entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);

      // Stub: in production this would call an external screening provider
      // For now we record the result in the event store
      const screeningResult = {
        entity_id: parsed.entity_id,
        provider: parsed.provider,
        result: parsed.result,
        screened_at: new Date().toISOString(),
        details: parsed.details || {},
      };

      // If screening found a match → auto-create compliance case
      if (parsed.result === "match") {
        await admin.from("compliance_cases").insert({
          org_id: entity.org_id,
          entity_id: parsed.entity_id,
          status: "open",
        });
      }

      // Update entity status if blocked
      if (parsed.result === "match") {
        await admin
          .from("entities")
          .update({ status: "suspended" })
          .eq("id", parsed.entity_id);
      }

      const eventHash = await sha256(JSON.stringify(screeningResult));
      await admin.from("event_store").insert({
        org_id: entity.org_id,
        domain: "compliance",
        aggregate_type: "entity",
        aggregate_id: parsed.entity_id,
        event_type: "compliance.screening.completed",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: screeningResult,
        event_hash: eventHash,
      });

      return new Response(
        JSON.stringify(successEnvelope(screeningResult, correlationId)),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── GET /entities ── List or get by ID
    if (req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");
      const allOrgs = url.searchParams.get("all") === "true" && isAdmin;
      const statusFilter = url.searchParams.get("status");
      const typeFilter = url.searchParams.get("entity_type");
      const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);

      if (entityId) {
        let query = admin.from("entities").select("*").eq("id", entityId);
        if (!isAdmin) query = query.eq("org_id", orgId);
        const { data: entity, error } = await query.maybeSingle();
        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
        if (!entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);

        return new Response(
          JSON.stringify(successEnvelope(entity, correlationId)),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      let query = admin.from("entities").select("*", { count: "exact" });
      if (!allOrgs) query = query.eq("org_id", orgId);
      if (statusFilter) query = query.eq("status", statusFilter);
      if (typeFilter) query = query.eq("entity_type", typeFilter);
      query = query.order("created_at", { ascending: false }).limit(limit);

      const { data: entities, error, count } = await query;
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(
        JSON.stringify(successEnvelope(entities || [], correlationId, { total_count: count })),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── PATCH /entities?entity_id=<uuid> ── Update entity (admin only)
    if (req.method === "PATCH") {
      requireRole(authCtx, "platform_admin");
      const entityId = url.searchParams.get("entity_id");
      if (!entityId) throw new ApiException("VALIDATION_ERROR", "entity_id parameter required", 400);
      await requireMfaForPlatformAdmin("entity.mutate", { id: entityId });

      const body = await req.json();
      const parsed = EntityUpdateSchema.parse(body);

      const { data: updated, error } = await admin
        .from("entities")
        .update(parsed)
        .eq("id", entityId)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      const eventHash = await sha256(JSON.stringify({ entity_id: entityId, updates: parsed }));
      await admin.from("event_store").insert({
        org_id: updated.org_id,
        domain: "trust",
        aggregate_type: "entity",
        aggregate_id: entityId,
        event_type: "trust.entity.updated",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: parsed,
        event_hash: eventHash,
      });

      return new Response(
        JSON.stringify(successEnvelope(updated, correlationId)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── DELETE /entities?entity_id=<uuid> ── Soft-delete (admin only)
    if (req.method === "DELETE") {
      requireRole(authCtx, "platform_admin");
      const entityId = url.searchParams.get("entity_id");
      if (!entityId) throw new ApiException("VALIDATION_ERROR", "entity_id parameter required", 400);
      await requireMfaForPlatformAdmin("entity.mutate", { id: entityId });


      const { data: archived, error } = await admin
        .from("entities")
        .update({ status: "archived" })
        .eq("id", entityId)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      const eventHash = await sha256(JSON.stringify({ entity_id: entityId, action: "archived" }));
      await admin.from("event_store").insert({
        org_id: archived.org_id,
        domain: "trust",
        aggregate_type: "entity",
        aggregate_id: entityId,
        event_type: "trust.entity.archived",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { entity_id: entityId },
        event_hash: eventHash,
      });

      return new Response(
        JSON.stringify(successEnvelope({ entity_id: entityId, status: "archived" }, correlationId)),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ status: "ERROR", code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (err instanceof ApiException) {
      return new Response(
        JSON.stringify({ status: "ERROR", code: err.code, message: err.message }),
        { status: err.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ status: "ERROR", code: "INTERNAL_ERROR", message: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
