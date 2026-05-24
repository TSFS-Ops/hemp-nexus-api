import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { assertAal2 } from "../_shared/aal.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import {
  assertIdempotencyKey,
  cachedResponseToHttp,
  lookupIdempotentResponse,
  storeIdempotentResponse,
} from "../_shared/idempotency.ts";

/**
 * Governance Documents Edge Function - V3 Sprint 3
 *
 * POST: Submit governance document for a deal, validates against registry.
 *       Burns tokens when validated (fixed_token_burn_amount from registry).
 * GET:  List governance documents for an org.
 * PATCH: Validate a governance document (compliance/admin role required).
 */

const GovDocCreateSchema = z.object({
  registry_id: z.string().uuid(),
  deal_reference_id: z.string().uuid(),
  deal_reference_type: z.enum(["POI", "WAD", "POD"]),
  document_path: z.string().min(1).max(500).optional(),
});

const GovDocValidateSchema = z.object({
  governance_doc_id: z.string().uuid(),
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
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const corsRes = handleCors(req, allowedOrigins);
  if (corsRes) return corsRes;

  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);
  const correlationId = req.headers.get("X-Correlation-ID") || crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    const orgId = authCtx.orgId;
    if (!orgId) throw new ApiException("FORBIDDEN", "No organisation found", 403);

    // ── Server-side governance role enforcement ──
    // The route guard in the SPA can be bypassed by direct API calls.
    // Only governance-domain principals (or API keys with the explicit
    // governance scope) may interact with governance documents.
    // Tightened to match the SPA route guard exactly (src/App.tsx GOVERNANCE_ROLES).
    // Drift between UI and server lists allowed an attacker to deduce which
    // roles the UI was hiding. These three roles are the single source of truth.
    const GOVERNANCE_ROLES = ["platform_admin", "auditor", "org_admin"];
    const GOVERNANCE_SCOPES = ["governance", "governance:read", "governance:write"];
    const callerRoles = authCtx.roles || [];
    const isGovernancePrincipal = authCtx.isApiKey
      ? callerRoles.some((r) => GOVERNANCE_SCOPES.includes(r) || r.startsWith("governance:"))
      : callerRoles.some((r) => GOVERNANCE_ROLES.includes(r));
    if (!isGovernancePrincipal) {
      throw new ApiException(
        "FORBIDDEN",
        "Governance role required (platform_admin, auditor, org_admin, or compliance role)",
        403,
      );
    }

    const url = new URL(req.url);

    // ── POST: Submit governance document ──
    if (req.method === "POST") {
      // Idempotency guard — duplicate submissions must not double-insert
      // governance documents or fire the validated→token-burn pipeline twice.
      // Header is REQUIRED (hard-mode) — token-burning endpoints cannot afford
      // to silently let retries through without dedupe.
      const idempotencyKey = req.headers.get("Idempotency-Key");
      if (!idempotencyKey) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Idempotency-Key header is required",
          400,
        );
      }
      const idemOpts = {
        supabase: admin,
        orgId,
        endpoint: "POST /governance-docs",
        idempotencyKey,
        requestId: correlationId,
      };
      const cached = await lookupIdempotentResponse(idemOpts);
      if (cached) return cachedResponseToHttp(cached, headers);

      const body = await req.json();
      const parsed = GovDocCreateSchema.parse(body);

      // Verify registry entry exists and is active
      const { data: registry } = await admin
        .from("governance_doc_registry")
        .select("*")
        .eq("id", parsed.registry_id)
        .eq("active", true)
        .maybeSingle();

      if (!registry) {
        throw new ApiException("NOT_FOUND", "Governance document registry entry not found or inactive", 404);
      }

      // Check for existing submission
      const { data: existingDoc } = await admin
        .from("governance_documents")
        .select("id")
        .eq("registry_id", parsed.registry_id)
        .eq("deal_reference_id", parsed.deal_reference_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (existingDoc) {
        throw new ApiException("CONFLICT", "Governance document already submitted for this deal", 409);
      }

      const insertPayload: Record<string, unknown> = {
          org_id: orgId,
          registry_id: parsed.registry_id,
          deal_reference_id: parsed.deal_reference_id,
          deal_reference_type: parsed.deal_reference_type,
          status: "DRAFT",
        };
      if (parsed.document_path) insertPayload.document_path = parsed.document_path;

      // Batch E Required Fix 3: if a document_path was supplied, validate
      // it is in scope and exists in storage BEFORE inserting, and clean
      // up + audit on any insert failure. Mirrors finalise-match-document-upload.
      const auditBase: Record<string, unknown> = {
        server_request_id: correlationId,
        user_id: authCtx.isApiKey ? null : authCtx.userId,
        profile_org_id: orgId,
        registry_id: parsed.registry_id,
        deal_reference_id: parsed.deal_reference_id,
        deal_reference_type: parsed.deal_reference_type,
        storage_path: parsed.document_path ?? null,
        bucket: parsed.document_path ? "match-documents" : null,
      };
      async function writeGovAudit(phase: string, outcome: "success" | "failure", extra: Record<string, unknown> = {}) {
        try {
          await admin.from("audit_logs").insert({
            org_id: orgId,
            actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
            action: "document.upload.attempt",
            entity_type: "governance_document",
            entity_id: parsed.deal_reference_id,
            metadata: { ...auditBase, phase, outcome, ...extra },
          });
        } catch (_e) { /* best-effort */ }
      }
      async function cleanupGovOrphan(reason: string) {
        if (!parsed.document_path) return { cleanup_attempted: false as const, cleanup_succeeded: false as const };
        const { error: rmErr } = await admin.storage
          .from("match-documents")
          .remove([parsed.document_path]);
        await writeGovAudit(rmErr ? "orphan_cleanup" : "cleanup", rmErr ? "failure" : "success", {
          reason,
          cleanup_attempted: true,
          cleanup_succeeded: !rmErr,
          cleanup_error: rmErr?.message ?? null,
        });
        return { cleanup_attempted: true, cleanup_succeeded: !rmErr } as const;
      }

      // Scope check: storage path must live under <orgId>/<deal_reference_id>/...
      if (parsed.document_path) {
        const [pathOrg, pathMatch] = parsed.document_path.split("/");
        if (pathOrg !== orgId || pathMatch !== parsed.deal_reference_id) {
          await cleanupGovOrphan("storage_path_scope_mismatch");
          throw new ApiException("STORAGE_PATH_SCOPE_MISMATCH", "Storage path does not belong to this organisation and deal", 400);
        }
        const { data: storageHead, error: storageErr } = await admin.storage
          .from("match-documents")
          .download(parsed.document_path);
        if (storageErr || !storageHead) {
          await writeGovAudit("finalise", "failure", {
            error_code: "STORAGE_OBJECT_MISSING",
            error_message: storageErr?.message ?? "Storage object missing",
            storage_object_exists: false,
          });
          throw new ApiException("STORAGE_OBJECT_MISSING", "The uploaded governance file could not be verified.", 409);
        }
      }

      const { data: govDoc, error } = await admin
        .from("governance_documents")
        .insert(insertPayload)
        .select()
        .single();

      if (error) {
        const cleanupResult = await cleanupGovOrphan("governance_documents_insert_failed");
        await writeGovAudit("db_insert", "failure", {
          db_insert_result: "failure",
          error_code: error.code ?? "DB_INSERT_FAILED",
          error_message: error.message?.slice(0, 2000) ?? null,
          storage_object_exists: !!parsed.document_path,
          ...cleanupResult,
        });
        throw new ApiException("INTERNAL_ERROR", error.message, 500);
      }

      await writeGovAudit("finalise", "success", {
        db_insert_result: "success",
        storage_object_exists: !!parsed.document_path,
        governance_doc_id: govDoc.id,
      });

      // Record event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "governance",
        aggregate_type: "governance_document",
        aggregate_id: govDoc.id,
        event_type: "governance.document.submitted",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: {
          registry_id: parsed.registry_id,
          doc_type: registry.doc_type,
          deal_reference_id: parsed.deal_reference_id,
        },
        event_hash: await computeHash(JSON.stringify({ doc_id: govDoc.id })),
      });

      const responseBody = successEnvelope(govDoc, correlationId);
      await storeIdempotentResponse(idemOpts, { status: 201, body: responseBody });
      return new Response(
        JSON.stringify(responseBody),
        { status: 201, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── PATCH: Validate governance document + token burn ──
    if (req.method === "PATCH") {
      // Only compliance roles or admins can validate
      const isComplianceOrAdmin = authCtx.roles.some((r) =>
        ["admin", "platform_admin", "compliance_analyst", "legal_reviewer"].includes(r)
      );
      if (!isComplianceOrAdmin) {
        throw new ApiException("FORBIDDEN", "Only compliance or admin roles can validate governance documents", 403);
      }

      // Idempotency guard — token burns must never double-charge on retry.
      // Header is REQUIRED (hard-mode).
      const patchKey = req.headers.get("Idempotency-Key");
      if (!patchKey) {
        throw new ApiException(
          "VALIDATION_ERROR",
          "Idempotency-Key header is required",
          400,
        );
      }
      const patchIdemOpts = {
        supabase: admin,
        orgId,
        endpoint: "PATCH /governance-docs",
        idempotencyKey: patchKey,
        requestId: correlationId,
      };
      const cachedPatch = await lookupIdempotentResponse(patchIdemOpts);
      if (cachedPatch) return cachedResponseToHttp(cachedPatch, headers);

      const body = await req.json();
      const parsed = GovDocValidateSchema.parse(body);

      const { data: govDoc } = await admin
        .from("governance_documents")
        .select("*, governance_doc_registry!inner(fixed_token_burn_amount, doc_type)")
        .eq("id", parsed.governance_doc_id)
        .maybeSingle();

      if (!govDoc) throw new ApiException("NOT_FOUND", "Governance document not found", 404);
      if (govDoc.status === "VALIDATED") {
        throw new ApiException("CONFLICT", "Document already validated", 409);
      }

      const burnAmount = (govDoc as any).governance_doc_registry?.fixed_token_burn_amount || 0;
      const docType = (govDoc as any).governance_doc_registry?.doc_type || null;

      // Atomic validation: burn + status update + audit log in single DB transaction
      const { data: validateResult, error: validateError } = await admin.rpc("atomic_validate_governance_doc", {
        p_governance_doc_id: parsed.governance_doc_id,
        p_org_id: govDoc.org_id,
        p_burn_amount: burnAmount,
        p_actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        p_doc_type: docType,
      });

      if (validateError) throw new ApiException("INTERNAL_ERROR", validateError.message, 500);

      const vResult = validateResult as { success: boolean; idempotent?: boolean; error?: string; message?: string; burn_amount?: number; balance_after?: number };
      if (!vResult.success) {
        const statusCode = vResult.error === "INSUFFICIENT_TOKENS" ? 422 : vResult.error === "NOT_FOUND" ? 404 : 500;
        throw new ApiException(vResult.error || "INTERNAL_ERROR", vResult.message || "Validation failed", statusCode);
      }

      // Fetch updated row for response
      const { data: updated } = await admin
        .from("governance_documents")
        .select()
        .eq("id", parsed.governance_doc_id)
        .single();

      // Record event (non-transactional but acceptable — doc is already validated)
      await admin.from("event_store").insert({
        org_id: govDoc.org_id,
        domain: "governance",
        aggregate_type: "governance_document",
        aggregate_id: govDoc.id,
        event_type: "governance.document.validated",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { token_burned: burnAmount, validated_by: authCtx.userId },
        event_hash: await computeHash(JSON.stringify({ doc_id: govDoc.id, validated: true })),
      });

      const patchResponseBody = successEnvelope({ ...updated, token_burned_amount: burnAmount }, correlationId);
      await storeIdempotentResponse(patchIdemOpts, { status: 200, body: patchResponseBody });
      return new Response(
        JSON.stringify(patchResponseBody),
        { headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // ── GET: List governance documents ──
    if (req.method === "GET") {
      const dealId = url.searchParams.get("deal_reference_id");

      let query = admin
        .from("governance_documents")
        .select("*, governance_doc_registry(doc_type, category, mandatory_flag)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (dealId) {
        query = query.eq("deal_reference_id", dealId);
      }

      const { data, error } = await query;
      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify(successEnvelope(data || [], correlationId)), {
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("VALIDATION_ERROR", "Method not allowed", 405);
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.error(`[${correlationId}] Validation error:`, err.errors);
      return new Response(
        JSON.stringify({
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: { code: "VALIDATION_ERROR", message: err.errors.map((e) => e.message).join(", ") },
        }),
        { status: 400, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
    if (err instanceof ApiException) {
      console.error(`[${correlationId}] ApiException [${err.code}] ${err.statusCode}:`, err.message);
      return new Response(
        JSON.stringify({
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: { code: err.code, message: err.message },
        }),
        { status: err.statusCode, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
    console.error(`[${correlationId}] Unhandled error:`, err);
    return new Response(
      JSON.stringify({
        status: "ERROR",
        timestamp: new Date().toISOString(),
        correlation_id: correlationId,
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      }),
      { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
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
