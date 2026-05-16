import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException, errorResponse } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { isBypassEnabled, recordBypassUsage, bypassEnvelope, checkMaintenanceMode } from "../_shared/test-mode-bypass.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";
import { fetchWithTimeout, ProviderTimeoutError, isProviderFailureStatus } from "../_shared/fetch-with-timeout.ts";
import { checkProviderCooldown, recordProviderFailure, cooldownResponseEnvelope } from "../_shared/provider-retry.ts";

/** Batch F: thrown by provider helpers when the provider is unreachable/degraded. */
class IdvProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly statusCode: number | null,
    public readonly reason: string,
  ) {
    super(`${provider} provider_error: ${reason}`);
  }
}

/**
 * IDV-001 & IDV-002: Identity/Company Verification
 *
 * Supports multiple providers via admin_settings key "idv_provider":
 *   - "onfido" - Onfido IDV API (requires ONFIDO_API_KEY)
 *   - "cipc"   - South African CIPC company registry (requires CIPC_API_KEY)
 *   - "companies_house" - UK Companies House (requires COMPANIES_HOUSE_API_KEY)
 *   - "stub"   - returns verified for dev/test
 *
 * POST: Submit verification request
 * GET:  Check verification status
 */

interface VerificationResult {
  provider: string;
  status: "verified" | "review" | "rejected" | "pending";
  provider_reference?: string;
  details: Record<string, unknown>;
}

// ── Provider: Onfido (stub - ready for real integration) ──
async function verifyWithOnfido(entityId: string, entityType: string, name: string, docType?: string): Promise<VerificationResult> {
  const apiKey = Deno.env.get("ONFIDO_API_KEY");
  if (!apiKey) {
    throw new ApiException(
      "CONFIGURATION_ERROR",
      "Onfido API key not configured. Set ONFIDO_API_KEY secret to enable IDV.",
      500,
      { provider: "onfido", setup_required: true }
    );
  }

  // TODO: Replace with real Onfido API call
  // Documentation: https://documentation.onfido.com/
  // Step 1: POST /applicants → create applicant
  // Step 2: POST /checks → create check with document + facial_similarity reports
  // Step 3: GET /checks/{id} → poll for result
  throw new ApiException(
    "PROVIDER_NOT_IMPLEMENTED",
    "Onfido integration requires implementation. API key is configured - add the API call logic.",
    501,
    { provider: "onfido", api_key_configured: true }
  );
}

// ── Provider: CIPC (South African company registry) ──
async function verifyWithCIPC(entityId: string, regNumber: string, name: string): Promise<VerificationResult> {
  const apiKey = Deno.env.get("CIPC_API_KEY");
  if (!apiKey) {
    throw new ApiException(
      "CONFIGURATION_ERROR",
      "CIPC API key not configured. Set CIPC_API_KEY secret.",
      500,
      { provider: "cipc", setup_required: true }
    );
  }

  // TODO: Integrate with CIPC e-Services API
  // https://eservices.cipc.co.za/
  throw new ApiException(
    "PROVIDER_NOT_IMPLEMENTED",
    "CIPC integration requires implementation. API key is configured.",
    501,
    { provider: "cipc", api_key_configured: true }
  );
}

// ── Provider: Companies House (UK) ──
async function verifyWithCompaniesHouse(regNumber: string, name: string): Promise<VerificationResult> {
  const apiKey = Deno.env.get("COMPANIES_HOUSE_API_KEY");
  if (!apiKey) {
    throw new ApiException(
      "CONFIGURATION_ERROR",
      "Companies House API key not configured. Set COMPANIES_HOUSE_API_KEY secret.",
      500,
      { provider: "companies_house", setup_required: true }
    );
  }

  // Batch F: bounded timeout + provider-error mapping (timeout/5xx/429).
  let res: Response;
  try {
    res = await fetchWithTimeout(
      "companies_house",
      `https://api.company-information.service.gov.uk/company/${encodeURIComponent(regNumber)}`,
      { headers: { Authorization: `Basic ${btoa(apiKey + ":")}` } },
      10_000,
    );
  } catch (err) {
    if (err instanceof ProviderTimeoutError) {
      throw new IdvProviderError("companies_house", 504, "timeout");
    }
    throw new IdvProviderError("companies_house", null, (err as Error).message);
  }

  if (!res.ok) {
    if (res.status === 404) {
      return { provider: "companies_house", status: "rejected", details: { reason: "Company not found" } };
    }
    if (isProviderFailureStatus(res.status)) {
      throw new IdvProviderError("companies_house", res.status, `upstream_${res.status}`);
    }
    throw new IdvProviderError("companies_house", res.status, `unexpected_${res.status}`);
  }

  const data = await res.json();
  const nameMatch = data.company_name?.toLowerCase().includes(name.toLowerCase().substring(0, 10));

  return {
    provider: "companies_house",
    status: nameMatch && data.company_status === "active" ? "verified" : "review",
    provider_reference: data.company_number,
    details: {
      company_name: data.company_name,
      company_number: data.company_number,
      company_status: data.company_status,
      type: data.type,
      date_of_creation: data.date_of_creation,
      registered_office_address: data.registered_office_address,
      name_match: nameMatch,
    },
  };
}

// ── Provider: Stub ──
async function verifyWithStub(entityId: string, entityType: string, name: string): Promise<VerificationResult> {
  return {
    provider: "stub",
    status: "verified",
    provider_reference: `stub-${entityId}`,
    details: { name, entity_type: entityType, note: "Stub verification - dev/test only" },
  };
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
      // ── Maintenance gate (platform admins exempt) ──
      const maintenance = await checkMaintenanceMode(admin, {
        source: "idv-verify",
        requestId,
        actorUserId,
        orgId,
        action: "idv_verify",
      });
      if (maintenance.blocked) {
        return new Response(
          JSON.stringify({
            error: "Service temporarily unavailable — platform is in maintenance mode.",
            code: "MAINTENANCE_MODE",
            requestId,
          }),
          { status: 503, headers: { ...headers, "Content-Type": "application/json" } },
        );
      }

      const body = await req.json();
      const { entity_id, verification_type } = body;
      // verification_type: "individual" (IDV-001) or "company" (IDV-002)

      if (!entity_id) throw new ApiException("VALIDATION_ERROR", "entity_id required", 400);

      const { data: entity } = await admin
        .from("entities")
        .select("*")
        .eq("id", entity_id)
        .eq("org_id", orgId)
        .maybeSingle();

      if (!entity) throw new ApiException("NOT_FOUND", "Entity not found", 404);

      // ── Test-mode bypass: short-circuit any provider call when admin has flipped the flag ──
      if (await isBypassEnabled(admin, "idv", "idv-verify", requestId)) {
        const isCompanyBypass = entity.entity_type === "company" || entity.entity_type === "corporate" || verification_type === "company";
        await admin.from("entities").update({ status: "verified" }).eq("id", entity_id);

        await recordBypassUsage(admin, {
          gate: "idv",
          source: "idv-verify",
          requestId,
          orgId,
          actorUserId,
          details: {
            entity_id,
            entity_type: entity.entity_type,
            verification_type: isCompanyBypass ? "company" : "individual",
          },
        });

        const bypassResult = bypassEnvelope({
          provider: "test_mode_bypass",
          status: "verified" as const,
          provider_reference: `bypass-${entity_id}`,
          details: { name: entity.legal_name, entity_type: entity.entity_type },
        });

        return new Response(JSON.stringify({
          success: true,
          entity_id,
          verification: bypassResult,
        }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
      }

      // Resolve provider
      const { data: providerSetting } = await admin
        .from("admin_settings")
        .select("value")
        .eq("key", "idv_provider")
        .maybeSingle();

      const providerConfig = (providerSetting?.value as any) || {};
      const isCompany = entity.entity_type === "company" || entity.entity_type === "corporate" || verification_type === "company";

      let result: VerificationResult;

      try {
        if (isCompany) {
          const companyProvider = providerConfig.company_provider || "stub";
          if (companyProvider === "companies_house") {
            result = await verifyWithCompaniesHouse(entity.registration_number || "", entity.legal_name);
          } else if (companyProvider === "cipc") {
            result = await verifyWithCIPC(entity_id, entity.registration_number || "", entity.legal_name);
          } else {
            result = await verifyWithStub(entity_id, entity.entity_type, entity.legal_name);
          }
        } else {
          const individualProvider = providerConfig.individual_provider || "stub";
          if (individualProvider === "onfido") {
            result = await verifyWithOnfido(entity_id, entity.entity_type, entity.legal_name);
          } else {
            result = await verifyWithStub(entity_id, entity.entity_type, entity.legal_name);
          }
        }
      } catch (err) {
        // Batch F: provider-down → audit, do NOT promote entity, return typed envelope.
        if (err instanceof IdvProviderError) {
          await admin.from("audit_logs").insert({
            org_id: orgId,
            actor_user_id: actorUserId,
            action: "idv.failed",
            entity_type: "entity",
            entity_id,
            metadata: {
              provider: err.provider,
              status_code: err.statusCode,
              reason: err.reason,
              request_id: requestId,
              verification_type: isCompany ? "company" : "individual",
            },
          });
          return new Response(
            JSON.stringify({
              success: false,
              error: "PROVIDER_ERROR",
              provider: err.provider,
              reason: err.reason,
              status_code: err.statusCode,
              message:
                "The identity verification provider is currently unavailable. The entity remains pending and an admin can review the failure.",
              entity_id,
              requestId,
            }),
            { status: 502, headers: { ...headers, "Content-Type": "application/json" } },
          );
        }
        throw err;
      }

      // Update entity status based on result
      if (result.status === "verified") {
        await admin.from("entities").update({ status: "verified" }).eq("id", entity_id);
      }

      // Audit
      await admin.from("audit_logs").insert({
        org_id: orgId,
        actor_user_id: actorUserId,
        action: `idv.${isCompany ? "company" : "individual"}.completed`,
        entity_type: "entity",
        entity_id,
        metadata: {
          provider: result.provider,
          status: result.status,
          provider_reference: result.provider_reference,
        },
      });

      return new Response(JSON.stringify({
        success: true,
        entity_id,
        verification: result,
      }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Use POST", 405);
  } catch (err) {
    console.error(`[${requestId}] IDV error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
