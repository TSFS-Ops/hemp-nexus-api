import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface PreflightRequest {
  buyerOrgId: string;
  sellerOrgId: string;
  commodity?: string;
  quantityAmount?: number;
  quantityUnit?: string;
  priceAmount?: number;
  priceCurrency?: string;
}

interface RiskDelta {
  category: string;
  status: "pass" | "fail" | "warning";
  message: string;
  details?: Record<string, unknown>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify user
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorised" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: PreflightRequest = await req.json();
    const { buyerOrgId, sellerOrgId, commodity, quantityAmount, quantityUnit, priceAmount, priceCurrency } = body;

    if (!buyerOrgId || !sellerOrgId) {
      return new Response(
        JSON.stringify({ error: "buyerOrgId and sellerOrgId are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(buyerOrgId) || !uuidRegex.test(sellerOrgId)) {
      return new Response(
        JSON.stringify({ error: "Invalid org ID format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (buyerOrgId === sellerOrgId) {
      return new Response(
        JSON.stringify({ error: "Buyer and seller cannot be the same organisation" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, serviceKey);
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
        const missing = required.filter((d: string) => !submitted.includes(d));
        deltas.push({
          category: "kyc",
          status: "fail",
          message: `${label} KYC incomplete (${kyc.completeness_percentage}%)`,
          details: { orgId, completeness: kyc.completeness_percentage, missingDocs: missing },
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
    if (!commodity || commodity.trim() === "") {
      fieldChecks.push({ category: "fields", status: "fail", message: "Commodity is required" });
    }
    if (!quantityAmount || quantityAmount <= 0) {
      fieldChecks.push({ category: "fields", status: "fail", message: "Quantity must be greater than zero" });
    }
    if (!quantityUnit || quantityUnit.trim() === "") {
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Preflight error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
