import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireRole } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { isBypassEnabled, recordBypassUsage } from "../_shared/test-mode-bypass.ts";
import { assertAal2 } from "../_shared/aal.ts";

/**
 * Authority-to-Bind & UBO Edge Function - Sprint 6
 *
 * Manages:
 * - Authority records (ATB): who can legally bind a company entity
 * - UBO links: beneficial ownership chain for WaD gate #3
 *
 * POST /authority-bind             → Create ATB record or UBO link
 * GET  /authority-bind             → List ATB records + UBO links
 * PATCH /authority-bind?id=<uuid>  → Update status (verify/reject)
 * POST /authority-bind/check       → Validate WaD gates #3 + #4 for a pair
 */

const AtbCreateSchema = z.object({
  type: z.enum(["atb", "ubo"]),
  company_entity_id: z.string().uuid(),
  person_entity_id: z.string().uuid(),
  // ATB-specific
  method: z.string().max(100).optional(),
  document_id: z.string().uuid().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
  // UBO-specific
  ownership_percentage: z.number().min(0.01).max(100).optional(),
});

const StatusUpdateSchema = z.object({
  status: z.enum(["verified", "rejected", "expired"]),
});

const GateCheckSchema = z.object({
  entity_id_a: z.string().uuid(),
  entity_id_b: z.string().uuid(),
});

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function envelope(data: unknown, correlationId: string) {
  return { status: "SUCCESS", timestamp: new Date().toISOString(), correlation_id: correlationId, data };
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

    const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const subAction = pathParts[pathParts.length - 1];

    const isAdmin = authCtx.roles?.includes("admin") || authCtx.roles?.includes("platform_admin");

    // ── POST /authority-bind/check ── Validate gates #3 (UBO) + #4 (ATB) for entity pair
    if (req.method === "POST" && subAction === "check") {
      const body = await req.json();
      const { entity_id_a, entity_id_b } = GateCheckSchema.parse(body);

      // Test-mode bypass: short-circuit both gates as passed.
      const [bypassUbo, bypassAtb] = await Promise.all([
        isBypassEnabled(admin, "ubo", "authority-bind/check", correlationId),
        isBypassEnabled(admin, "authority", "authority-bind/check", correlationId),
      ]);

      const checkUbo = bypassUbo
        ? async (entityId: string) => ({ entity_id: entityId, total_ownership: 100, passed: true, bypass: true as const })
        : async (entityId: string) => {
            const { data: links } = await admin
              .from("ubo_links")
              .select("ownership_percentage")
              .eq("company_entity_id", entityId)
              .eq("status", "verified");
            const totalOwnership = (links || []).reduce((sum: number, l: any) => sum + Number(l.ownership_percentage), 0);
            return { entity_id: entityId, total_ownership: totalOwnership, passed: totalOwnership >= 100 };
          };

      const checkAtb = bypassAtb
        ? async (entityId: string) => ({ entity_id: entityId, active_records: 1, passed: true, bypass: true as const })
        : async (entityId: string) => {
            const { data: records } = await admin
              .from("authority_records")
              .select("id, status, expires_at")
              .eq("company_entity_id", entityId)
              .eq("status", "verified");
            const activeRecords = (records || []).filter(
              (r: any) => !r.expires_at || new Date(r.expires_at) > new Date()
            );
            return { entity_id: entityId, active_records: activeRecords.length, passed: activeRecords.length > 0 };
          };

      const [uboA, uboB, atbA, atbB] = await Promise.all([
        checkUbo(entity_id_a),
        checkUbo(entity_id_b),
        checkAtb(entity_id_a),
        checkAtb(entity_id_b),
      ]);

      // Audit any bypass usage exactly once per gate-check call.
      if (bypassUbo) {
        await recordBypassUsage(admin, {
          gate: "ubo", source: "authority-bind/check", orgId, actorUserId: authCtx.userId || null,
          details: { entity_id_a, entity_id_b, gate: 3 },
        });
      }
      if (bypassAtb) {
        await recordBypassUsage(admin, {
          gate: "authority", source: "authority-bind/check", orgId, actorUserId: authCtx.userId || null,
          details: { entity_id_a, entity_id_b, gate: 4 },
        });
      }

      const gates = {
        ubo_integrity: { gate: 3, passed: uboA.passed && uboB.passed, bypass: bypassUbo, details: { entity_a: uboA, entity_b: uboB } },
        authority_to_bind: { gate: 4, passed: atbA.passed && atbB.passed, bypass: bypassAtb, details: { entity_a: atbA, entity_b: atbB } },
        all_passed: (uboA.passed && uboB.passed) && (atbA.passed && atbB.passed),
      };

      return new Response(JSON.stringify(envelope(gates, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── POST /authority-bind ── Create ATB record or UBO link
    if (req.method === "POST") {
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) throw new ApiException("VALIDATION_ERROR", "Idempotency-Key header required", 400);

      const body = await req.json();
      const parsed = AtbCreateSchema.parse(body);

      if (parsed.type === "ubo") {
        if (!parsed.ownership_percentage) {
          throw new ApiException("VALIDATION_ERROR", "ownership_percentage required for UBO links", 400);
        }

        const { data: link, error } = await admin
          .from("ubo_links")
          .insert({
            org_id: orgId,
            company_entity_id: parsed.company_entity_id,
            person_entity_id: parsed.person_entity_id,
            ownership_percentage: parsed.ownership_percentage,
            document_id: parsed.document_id || null,
            expires_at: parsed.expires_at || null,
          })
          .select()
          .single();

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

        const eventHash = await sha256(JSON.stringify({ ubo_link_id: link.id }));
        await admin.from("event_store").insert({
          org_id: orgId, domain: "trust", aggregate_type: "ubo_link", aggregate_id: link.id,
          event_type: "trust.ubo.created",
          actor_id: authCtx.isApiKey ? null : authCtx.userId,
          actor_role: authCtx.roles?.[0] || null,
          payload: { company_entity_id: parsed.company_entity_id, person_entity_id: parsed.person_entity_id, ownership_percentage: parsed.ownership_percentage },
          event_hash: eventHash,
        });

        return new Response(JSON.stringify(envelope(link, correlationId)), {
          status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ATB record
      const { data: record, error } = await admin
        .from("authority_records")
        .insert({
          org_id: orgId,
          company_entity_id: parsed.company_entity_id,
          person_entity_id: parsed.person_entity_id,
          method: parsed.method || "board_resolution",
          document_id: parsed.document_id || null,
          expires_at: parsed.expires_at || null,
        })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      const eventHash = await sha256(JSON.stringify({ atb_id: record.id }));
      await admin.from("event_store").insert({
        org_id: orgId, domain: "trust", aggregate_type: "authority_record", aggregate_id: record.id,
        event_type: "trust.atb.created",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { company_entity_id: parsed.company_entity_id, person_entity_id: parsed.person_entity_id, method: parsed.method },
        event_hash: eventHash,
      });

      return new Response(JSON.stringify(envelope(record, correlationId)), {
        status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET /authority-bind ── List ATB records + UBO links
    if (req.method === "GET") {
      const entityId = url.searchParams.get("entity_id");
      const recordType = url.searchParams.get("type") || "all";
      const allOrgs = url.searchParams.get("all") === "true" && isAdmin;

      const result: Record<string, unknown> = {};

      if (recordType === "all" || recordType === "atb") {
        let q = admin.from("authority_records").select("*, entities!authority_records_company_entity_id_fkey(legal_name)");
        if (!allOrgs) q = q.eq("org_id", orgId);
        if (entityId) q = q.eq("company_entity_id", entityId);
        q = q.order("created_at", { ascending: false }).limit(200);
        const { data } = await q;
        result.authority_records = data || [];
      }

      if (recordType === "all" || recordType === "ubo") {
        let q = admin.from("ubo_links").select("*");
        if (!allOrgs) q = q.eq("org_id", orgId);
        if (entityId) q = q.eq("company_entity_id", entityId);
        q = q.order("created_at", { ascending: false }).limit(200);
        const { data } = await q;
        result.ubo_links = data || [];
      }

      return new Response(JSON.stringify(envelope(result, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── PATCH /authority-bind?id=<uuid>&type=<atb|ubo> ── Update status
    if (req.method === "PATCH") {
      requireRole(authCtx, "platform_admin");
      const recordId = url.searchParams.get("id");
      const recordType = url.searchParams.get("type") || "atb";
      if (!recordId) throw new ApiException("VALIDATION_ERROR", "id parameter required", 400);

      const body = await req.json();
      const { status } = StatusUpdateSchema.parse(body);
      const now = new Date().toISOString();

      if (recordType === "ubo") {
        const updateData: Record<string, unknown> = { status };
        if (status === "verified") {
          updateData.verified_at = now;
          updateData.verified_by = authCtx.userId;
        }
        const { data, error } = await admin.from("ubo_links").update(updateData).eq("id", recordId).select().single();
        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

        return new Response(JSON.stringify(envelope(data, correlationId)), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // ATB
      const updateData: Record<string, unknown> = { status };
      if (status === "verified") {
        updateData.verified_at = now;
        updateData.verified_by = authCtx.userId;
      }
      const { data, error } = await admin.from("authority_records").update(updateData).eq("id", recordId).select().single();
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify(envelope(data, correlationId)), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
