import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";

interface RiskDelta {
  category: string;
  status: "pass" | "fail" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    if (req.method !== "POST") {
      throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Auth via shared module (JWT + API key) ──
    const authCtx = await authenticateRequest(req, supabaseUrl, serviceKey);
    if (authCtx.isApiKey) {
      requireScope(authCtx, "preflight");
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { actorApiKeyId } = deriveActorIds(authCtx);

    await checkRateLimit(adminClient, authCtx.orgId, actorApiKeyId, "preflight", "preflight");

    const body = await req.json();
    const { buyerOrgId, sellerOrgId, commodity, quantityAmount, quantityUnit, priceAmount, priceCurrency } = body;

    if (!buyerOrgId || !sellerOrgId) {
      throw new ApiException("VALIDATION_ERROR", "buyerOrgId and sellerOrgId are required", 400);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(buyerOrgId) || !uuidRegex.test(sellerOrgId)) {
      throw new ApiException("VALIDATION_ERROR", "Invalid org ID format", 400);
    }

    if (buyerOrgId === sellerOrgId) {
      throw new ApiException("VALIDATION_ERROR", "Buyer and seller cannot be the same organisation", 400);
    }

    // ── Security: cross-org isolation ──
    // Fixes finding `preflight_crossorg_leak`. Without this guard, any
    // authenticated user could probe arbitrary org pairs and read their
    // KYC completeness, missing-doc list, risk band, risk score, and
    // pending-approval state via the service-role client below.
    // A caller must either be a party to the proposed trade (their org_id
    // matches buyer or seller) or be a platform_admin. API-key callers are
    // already scope-gated above; we still enforce party-membership unless
    // the org is platform-admin elevated.
    if (authCtx.orgId !== buyerOrgId && authCtx.orgId !== sellerOrgId) {
      let isAdmin = false;
      if (authCtx.userId) {
        const { data: adminFlag } = await adminClient.rpc("is_admin", {
          user_id: authCtx.userId,
        });
        isAdmin = adminFlag === true;
      }
      if (!isAdmin) {
        throw new ApiException(
          "FORBIDDEN",
          "You must be a party to this trade to run preflight",
          403,
        );
      }
    }

    const deltas: RiskDelta[] = [];

    // ── 1. Trade approval status for both parties ──
    for (const [label, orgId] of [["Buyer", buyerOrgId], ["Seller", sellerOrgId]] as const) {
      const { data: approval } = await adminClient
        .from("trade_approvals")
        .select("status, risk_band, valid_until")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!approval || approval.status !== "approved") {
        deltas.push({
          category: "trade_approval",
          status: "fail",
          message: `${label} is not Approved to Trade`,
          details: { orgId, currentStatus: approval?.status || "none" },
        });
      } else if (approval.valid_until && new Date(approval.valid_until) < new Date()) {
        deltas.push({
          category: "trade_approval",
          status: "fail",
          message: `${label} trade approval has expired`,
          details: { orgId, expiredAt: approval.valid_until },
        });
      } else {
        deltas.push({
          category: "trade_approval",
          status: "pass",
          message: `${label} is Approved to Trade`,
          details: { orgId, riskBand: approval.risk_band },
        });
      }
    }

    // ── 2. KYC completeness for both parties ──
    for (const [label, orgId] of [["Buyer", buyerOrgId], ["Seller", sellerOrgId]] as const) {
      const { data: kyc } = await adminClient
        .from("kyc_status")
        .select("status, completeness_percentage, required_docs, submitted_docs")
        .eq("org_id", orgId)
        .maybeSingle();

      if (!kyc) {
        deltas.push({
          category: "kyc",
          status: "fail",
          message: `${label} has no KYC records`,
          details: { orgId, missingDocs: ["all"] },
        });
      } else if (kyc.status !== "complete") {
        const required = Array.isArray(kyc.required_docs) ? kyc.required_docs : [];
        const submitted = Array.isArray(kyc.submitted_docs) ? kyc.submitted_docs : [];
        const missingItems = required.filter((d: string) => !submitted.includes(d));
        deltas.push({
          category: "kyc",
          status: "fail",
          message: `${label} KYC incomplete (${kyc.completeness_percentage}%)`,
          details: { orgId, completeness: kyc.completeness_percentage, missingDocs: missingItems },
        });
      } else {
        deltas.push({
          category: "kyc",
          status: "pass",
          message: `${label} KYC complete`,
          details: { orgId, completeness: 100 },
        });
      }
    }

    // ── 3. Risk band for both parties ──
    for (const [label, orgId] of [["Buyer", buyerOrgId], ["Seller", sellerOrgId]] as const) {
      const { data: risk } = await adminClient
        .from("dd_risk_scores")
        .select("score, risk_band, factors")
        .eq("org_id", orgId)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!risk) {
        deltas.push({
          category: "risk",
          status: "warning",
          message: `${label} has no risk assessment`,
          details: { orgId },
        });
      } else {
        const isHigh = risk.risk_band === "high" || risk.risk_band === "critical";
        deltas.push({
          category: "risk",
          status: isHigh ? "warning" : "pass",
          message: `${label} risk band: ${risk.risk_band} (score: ${risk.score})`,
          details: { orgId, score: risk.score, band: risk.risk_band, factors: risk.factors },
        });
      }
    }

    // ── 4. Pending approvals ──
    for (const [label, orgId] of [["Buyer", buyerOrgId], ["Seller", sellerOrgId]] as const) {
      const { data: pendingApprovals } = await adminClient
        .from("dd_approval_requests")
        .select("id, status, required_roles, completed_roles")
        .eq("target_org_id", orgId)
        .eq("status", "pending");

      if (pendingApprovals && pendingApprovals.length > 0) {
        const pending = pendingApprovals[0];
        const remainingRoles = (pending.required_roles || []).filter(
          (r: string) => !(pending.completed_roles || []).includes(r)
        );
        deltas.push({
          category: "approval_workflow",
          status: "fail",
          message: `${label} has pending approval (awaiting: ${remainingRoles.join(", ")})`,
          details: { orgId, approvalId: pending.id, remainingRoles },
        });
      }
    }

    // ── 5. Trade fields validation ──
    const fieldChecks: RiskDelta[] = [];
    if (!commodity || String(commodity).trim() === "") {
      fieldChecks.push({ category: "fields", status: "fail", message: "Commodity is required" });
    }
    if (!quantityAmount || quantityAmount <= 0) {
      fieldChecks.push({ category: "fields", status: "fail", message: "Quantity must be greater than zero" });
    }
    if (!quantityUnit || String(quantityUnit).trim() === "") {
      fieldChecks.push({ category: "fields", status: "fail", message: "Quantity unit is required" });
    }
    if (!priceAmount || priceAmount <= 0) {
      fieldChecks.push({ category: "fields", status: "fail", message: "Price must be greater than zero" });
    }
    if (!priceCurrency || !/^[A-Za-z]{3}$/.test(priceCurrency)) {
      fieldChecks.push({ category: "fields", status: "fail", message: "Valid 3-letter currency code required" });
    }
    if (fieldChecks.length === 0) {
      fieldChecks.push({ category: "fields", status: "pass", message: "All trade fields valid" });
    }
    deltas.push(...fieldChecks);

    // ── Compute overall pass/fail ──
    const hasFailures = deltas.some(d => d.status === "fail");
    const hasWarnings = deltas.some(d => d.status === "warning");

    return new Response(
      JSON.stringify({
        canCollapse: !hasFailures,
        overallStatus: hasFailures ? "fail" : hasWarnings ? "warning" : "pass",
        deltas,
        checkedAt: new Date().toISOString(),
        note: "This is a non-binding pre-flight check. No POI has been created.",
      }),
      { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(`[${requestId}] Preflight error:`, err);
    return errorResponse(err as Error, requestId, headers);
  }
});
