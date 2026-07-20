import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

/**
* Compliance Cases Edge Function - V3 Sprint 4
*
* POST: Open a compliance case against an entity.
* GET: List compliance cases for org.
* PATCH: Decide/close a compliance case (compliance/admin roles only).
*/

const CaseCreateSchema = z.object({
  entity_id: z.string().uuid(),
});

const CaseDecideSchema = z.object({
  case_id: z.string().uuid(),
  status: z.enum(["cleared", "escalated", "blocked"]),
  decision_notes: z.string().max(2048).optional(),
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

  // ── Server-side governance role enforcement ──
  // Compliance cases contain sensitive screening outcomes. Restrict to
  // governance principals; reject vanilla org_member callers even if they
  // belong to the same org. This mirrors the SPA route guard.
  // Tightened to match SPA route guard exactly. See governance-docs for rationale.
  //
  // PR #26 Phase 3 fix: this list must be a superset of every role checked
  // by any inner per-method gate below (currently the PATCH decide-case
  // check). Previously this outer gate only listed platform_admin, auditor
  // and org_admin, so legitimate compliance_analyst, legal_reviewer,
  // director and admin callers were rejected here with 403 before the
  // PATCH handler's own role check ever ran, even though that inner check
  // permitted them. Keep this list in sync with the PATCH gate below.
  const GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin", "admin", "compliance_analyst", "legal_reviewer", "director"];
             const GOVERNANCE_SCOPES = ["compliance", "compliance:read", "compliance:write", "governance"];
             const callerRoles = authCtx.roles || [];
             const isGovernancePrincipal = authCtx.isApiKey
             ? callerRoles.some((r) => GOVERNANCE_SCOPES.includes(r) || r.startsWith("compliance:") || r.startsWith("governance:"))
               : callerRoles.some((r) => GOVERNANCE_ROLES.includes(r));
             if (!isGovernancePrincipal) {
               throw new ApiException(
                 "FORBIDDEN",
                 "Governance role required (platform_admin, auditor, org_admin, or compliance role)",
                 403,
                 );
             }

  const url = new URL(req.url);

  // ── POST: Open case ──
  if (req.method === "POST") {
    assertIdempotencyKey(req);
    const body = await req.json();
    const parsed = CaseCreateSchema.parse(body);

             // Verify entity exists AND belongs to the caller's org
             const { data: entity } = await admin
    .from("entities")
    .select("id, org_id")
    .eq("id", parsed.entity_id)
    .maybeSingle();

             if (!entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);
    if (entity.org_id !== orgId) throw new ApiException("FORBIDDEN", "Entity does not belong to your organisation", 403);

             // Check for existing open case
             const { data: existingCase } = await admin
    .from("compliance_cases")
    .select("id")
    .eq("entity_id", parsed.entity_id)
    .eq("org_id", orgId)
    .eq("status", "open")
    .maybeSingle();

             if (existingCase) throw new ApiException("CONFLICT", "Open compliance case already exists for this entity", 409);

             const { data: compCase, error } = await admin
    .from("compliance_cases")
    .insert({
      org_id: orgId,
      entity_id: parsed.entity_id,
      status: "open",
    })
    .select()
    .single();

             if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

             await admin.from("event_store").insert({
               org_id: orgId,
               domain: "compliance",
               aggregate_type: "compliance_case",
               aggregate_id: compCase.id,
               event_type: "compliance.case.opened",
               actor_id: authCtx.isApiKey ? null : authCtx.userId,
               actor_role: authCtx.roles?.[0] || null,
               payload: { entity_id: parsed.entity_id },
               event_hash: await computeHash(JSON.stringify({ case_id: compCase.id })),
             });

             // Dispatch notification for compliance case opened
             await admin.functions.invoke("notification-dispatch", {
               body: {
                 event_type: "compliance.case.opened",
                 subject: "Compliance case opened",
                 message: `A new compliance case has been opened for entity ${parsed.entity_id}.`,
                 metadata: { org_id: orgId, case_id: compCase.id, entity_id: parsed.entity_id },
               },
             }).catch((err: any) => console.error("[compliance-cases] Notification dispatch failed:", err));

             return new Response(JSON.stringify(successEnvelope(compCase, correlationId)), {
               status: 201,
               headers: { ...corsHeaders, "Content-Type": "application/json" },
             });
  }

  // ── PATCH: Decide case ──
  if (req.method === "PATCH") {
    const isComplianceOrAdmin = authCtx.roles.some((r) =>
      ["admin", "platform_admin", "compliance_analyst", "legal_reviewer", "director"].includes(r)
                                                   );
    if (!isComplianceOrAdmin) {
      throw new ApiException("FORBIDDEN", "Only compliance or admin roles can decide cases", 403);
    }

             const body = await req.json();
    const parsed = CaseDecideSchema.parse(body);

             const { data: compCase } = await admin
    .from("compliance_cases")
    .select("*")
    .eq("id", parsed.case_id)
    .eq("org_id", orgId)
    .maybeSingle();

             if (!compCase) throw new ApiException("NOT_FOUND", "Case not found", 404);
    if (compCase.status !== "open") {
      throw new ApiException("CONFLICT", `Case is already ${compCase.status}`, 409);
    }

             const { data: updated, error } = await admin
    .from("compliance_cases")
    .update({
      status: parsed.status,
      decided_at: new Date().toISOString(),
      decided_by: authCtx.userId,
      decision_notes: parsed.decision_notes || null,
    })
    .eq("id", parsed.case_id)
    .select()
    .single();

             if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

             await admin.from("event_store").insert({
               org_id: orgId,
               domain: "compliance",
               aggregate_type: "compliance_case",
               aggregate_id: compCase.id,
               event_type: `compliance.case.${parsed.status}`,
               actor_id: authCtx.isApiKey ? null : authCtx.userId,
               actor_role: authCtx.roles?.[0] || null,
               payload: { decision: parsed.status, notes: parsed.decision_notes },
               event_hash: await computeHash(JSON.stringify({ case_id: compCase.id, status: parsed.status })),
             });

             // Dispatch notification for compliance case decision
             await admin.functions.invoke("notification-dispatch", {
               body: {
                 event_type: `compliance.case.${parsed.status}`,
                 subject: `Compliance case ${parsed.status}`,
                 message: `Compliance case ${compCase.id} has been ${parsed.status}.${parsed.decision_notes ? ` Notes: ${parsed.decision_notes}` : ""}`,
                 metadata: { org_id: orgId, case_id: compCase.id, status: parsed.status },
               },
             }).catch((err: any) => console.error("[compliance-cases] Notification dispatch failed:", err));

             return new Response(JSON.stringify(successEnvelope(updated, correlationId)), {
               headers: { ...corsHeaders, "Content-Type": "application/json" },
             });
  }

  // ── GET: List cases ──
  if (req.method === "GET") {
    const entityId = url.searchParams.get("entity_id");
    const status = url.searchParams.get("status");

             let query = admin
    .from("compliance_cases")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

             if (entityId) query = query.eq("entity_id", entityId);
    if (status) query = query.eq("status", status);

             const { data, error } = await query;
    if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

             return new Response(JSON.stringify(successEnvelope(data || [], correlationId)), {
               headers: { ...corsHeaders, "Content-Type": "application/json" },
             });
  }

  throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
           } catch (err) {
             if (err instanceof z.ZodError) {
               return new Response(
                 JSON.stringify({
                   status: "ERROR", timestamp: new Date().toISOString(), correlation_id: correlationId,
                   error: { code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") },
                 }),
                 { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                 );
             }
             if (err instanceof ApiException) {
               return new Response(
                 JSON.stringify({
                   status: "ERROR", timestamp: new Date().toISOString(), correlation_id: correlationId,
                   error: { code: err.code, message: err.message },
                 }),
                 { status: err.statusCode, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                 );
             }
             console.error("Unhandled error:", err);
             return new Response(
               JSON.stringify({
                 status: "ERROR", timestamp: new Date().toISOString(), correlation_id: correlationId,
                 error: { code: "INTERNAL_ERROR", message: "Internal server error" },
               }),
               { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
               );
           }
});

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
