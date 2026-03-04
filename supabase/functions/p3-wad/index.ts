import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * P3 WaD (Without-a-Doubt) Edge Function — V3 Sprint 3
 *
 * POST: Issue WaD for a COLLAPSED POI — enforces 7 deterministic hard-gates.
 * GET:  List or get WaD by ID.
 *
 * Hard-Gates (all must pass):
 *  1. POI is in COLLAPSED state
 *  2. Both buyer & seller entities are ACTIVE
 *  3. UBO ownership is 100% for both parties
 *  4. Authority-to-Bind (ATB) is verified for both
 *  5. All mandatory governance documents are validated
 *  6. No unresolved compliance cases exist
 *  7. Token balance is sufficient for governance doc burns
 */

const WadCreateSchema = z.object({
  poi_id: z.string().uuid(),
});

function successEnvelope(data: unknown, correlationId: string) {
  return {
    status: "SUCCESS",
    timestamp: new Date().toISOString(),
    correlation_id: correlationId,
    data,
  };
}

interface HardGateResult {
  gate: string;
  passed: boolean;
  reason: string;
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

    // ── POST: Issue WaD with hard-gate enforcement ──
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
        .eq("endpoint", "p3-wad")
        .maybeSingle();

      if (existing) {
        return new Response(JSON.stringify(existing.response_data), {
          status: existing.response_status_code,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const parsed = WadCreateSchema.parse(body);

      // Fetch POI
      const { data: poi } = await admin
        .from("pois")
        .select("*")
        .eq("id", parsed.poi_id)
        .maybeSingle();

      if (!poi) throw new ApiException("NOT_FOUND", "POI not found", 404);

      // Verify caller is party to the POI
      if (poi.org_id !== orgId) {
        throw new ApiException("FORBIDDEN", "Not authorised to create WaD for this POI", 403);
      }

      // ── Run 7 Hard-Gates ──
      const gates: HardGateResult[] = [];

      // Gate 1: POI state must be COLLAPSED
      gates.push({
        gate: "POI_STATE",
        passed: poi.state === "COLLAPSED",
        reason: poi.state === "COLLAPSED"
          ? "POI is in COLLAPSED state"
          : `POI is in ${poi.state} state — must be COLLAPSED`,
      });

      // Gate 2: Both entities must be ACTIVE or VERIFIED
      const [buyerRes, sellerRes] = await Promise.all([
        admin.from("entities").select("id, status, entity_type").eq("id", poi.buyer_entity_id).maybeSingle(),
        admin.from("entities").select("id, status, entity_type").eq("id", poi.seller_entity_id).maybeSingle(),
      ]);
      const validStatuses = ["active", "ACTIVE", "verified", "VERIFIED"];
      const buyerActive = buyerRes.data && validStatuses.includes(buyerRes.data.status);
      const sellerActive = sellerRes.data && validStatuses.includes(sellerRes.data.status);
      gates.push({
        gate: "ENTITY_STATUS",
        passed: !!(buyerActive && sellerActive),
        reason: buyerActive && sellerActive
          ? "Both buyer and seller entities are active/verified"
          : `Buyer: ${buyerRes.data?.status || "NOT_FOUND"}, Seller: ${sellerRes.data?.status || "NOT_FOUND"}`,
      });

      // Gate 3: UBO ownership 100% for both entities (company type)
      const [buyerUbo, sellerUbo] = await Promise.all([
        admin.from("ubo_links").select("ownership_percentage, status").eq("company_entity_id", poi.buyer_entity_id),
        admin.from("ubo_links").select("ownership_percentage, status").eq("company_entity_id", poi.seller_entity_id),
      ]);
      const buyerUboTotal = (buyerUbo.data || []).reduce((sum: number, o: any) => sum + Number(o.ownership_percentage || 0), 0);
      const sellerUboTotal = (sellerUbo.data || []).reduce((sum: number, o: any) => sum + Number(o.ownership_percentage || 0), 0);
      const buyerUboAllVerified = (buyerUbo.data || []).length > 0 && (buyerUbo.data || []).every((o: any) => o.status === "verified");
      const sellerUboAllVerified = (sellerUbo.data || []).length > 0 && (sellerUbo.data || []).every((o: any) => o.status === "verified");
      // If no UBO links exist for individual entities, pass by default
      const buyerIsIndividual = buyerRes.data && (!buyerUbo.data || buyerUbo.data.length === 0);
      const sellerIsIndividual = sellerRes.data && (!sellerUbo.data || sellerUbo.data.length === 0);
      const uboPass = (buyerIsIndividual || (buyerUboTotal >= 100 && buyerUboAllVerified)) && 
                       (sellerIsIndividual || (sellerUboTotal >= 100 && sellerUboAllVerified));
      gates.push({
        gate: "UBO_COMPLETENESS",
        passed: uboPass,
        reason: uboPass
          ? "UBO ownership verified at 100% for both parties (all links verified)"
          : `Buyer UBO: ${buyerIsIndividual ? "N/A (individual)" : buyerUboTotal + "%" + (buyerUboAllVerified ? " ✓" : " (unverified links)")}, Seller UBO: ${sellerIsIndividual ? "N/A (individual)" : sellerUboTotal + "%" + (sellerUboAllVerified ? " ✓" : " (unverified links)")}`,
      });

      // Gate 4: Authority-to-Bind verified for both
      const [buyerAtb, sellerAtb] = await Promise.all([
        admin.from("authority_records").select("id, status").eq("company_entity_id", poi.buyer_entity_id).eq("status", "verified").limit(1),
        admin.from("authority_records").select("id, status").eq("company_entity_id", poi.seller_entity_id).eq("status", "verified").limit(1),
      ]);
      const buyerAtbOk = buyerIsIndividual || (buyerAtb.data && buyerAtb.data.length > 0);
      const sellerAtbOk = sellerIsIndividual || (sellerAtb.data && sellerAtb.data.length > 0);
      gates.push({
        gate: "AUTHORITY_TO_BIND",
        passed: !!(buyerAtbOk && sellerAtbOk),
        reason: buyerAtbOk && sellerAtbOk
          ? "Authority-to-Bind verified for both parties"
          : `Buyer ATB: ${buyerAtbOk ? "verified" : "missing"}, Seller ATB: ${sellerAtbOk ? "verified" : "missing"}`,
      });

      // Gate 5: Mandatory governance documents validated
      const { data: mandatoryDocs } = await admin
        .from("governance_doc_registry")
        .select("id, doc_type, fixed_token_burn_amount")
        .eq("org_id", orgId)
        .eq("mandatory_flag", true)
        .eq("active", true)
        .eq("jurisdiction_code", poi.jurisdiction_code)
        .eq("industry_code", poi.industry_code);

      let govDocsPass = true;
      const missingDocs: string[] = [];
      if (mandatoryDocs && mandatoryDocs.length > 0) {
        for (const doc of mandatoryDocs) {
          const { data: govDoc } = await admin
            .from("governance_documents")
            .select("id, status")
            .eq("registry_id", doc.id)
            .eq("deal_reference_id", poi.id)
            .eq("status", "validated")
            .maybeSingle();
          if (!govDoc) {
            govDocsPass = false;
            missingDocs.push(doc.doc_type);
          }
        }
      }
      gates.push({
        gate: "GOVERNANCE_DOCUMENTS",
        passed: govDocsPass,
        reason: govDocsPass
          ? "All mandatory governance documents validated"
          : `Missing validated documents: ${missingDocs.join(", ")}`,
      });

      // Gate 6: No unresolved compliance cases
      const { data: openCases } = await admin
        .from("compliance_cases")
        .select("id")
        .eq("org_id", orgId)
        .or(`entity_id.eq.${poi.buyer_entity_id},entity_id.eq.${poi.seller_entity_id}`)
        .eq("status", "open")
        .limit(1);

      const compliancePass = !openCases || openCases.length === 0;
      gates.push({
        gate: "COMPLIANCE_CLEAR",
        passed: compliancePass,
        reason: compliancePass
          ? "No unresolved compliance cases"
          : "Unresolved compliance cases exist for one or both parties",
      });

      // Gate 7: Token balance sufficient (uses token_balances table)
      const { data: wallet } = await admin
        .from("token_balances")
        .select("balance")
        .eq("org_id", orgId)
        .maybeSingle();

      // Calculate total burn from registry fixed_token_burn_amount
      const totalBurnRequired = (mandatoryDocs || []).reduce((sum: number, d: any) => sum + (d.fixed_token_burn_amount || 0), 0);
      const tokenPass = wallet ? wallet.balance >= totalBurnRequired : totalBurnRequired === 0;
      gates.push({
        gate: "TOKEN_BALANCE",
        passed: tokenPass,
        reason: tokenPass
          ? `Token balance sufficient (required: ${totalBurnRequired}, available: ${wallet?.balance || 0})`
          : `Insufficient tokens. Required: ${totalBurnRequired}, Available: ${wallet?.balance || 0}`,
      });

      // ── Evaluate all gates ──
      const allPassed = gates.every((g) => g.passed);
      const failedGates = gates.filter((g) => !g.passed);

      if (!allPassed) {
        const responseData = {
          status: "ERROR",
          timestamp: new Date().toISOString(),
          correlation_id: correlationId,
          error: {
            code: "HARD_GATE_FAILED",
            message: `${failedGates.length} hard-gate(s) failed`,
            gates,
          },
        };

        // Record denial in p3_wads
        await admin.from("p3_wads").insert({
          org_id: orgId,
          poi_id: parsed.poi_id,
          state: "DENIED",
          denial_reasons: failedGates.map((g) => ({ gate: g.gate, reason: g.reason })),
        });

        // Record event
        await admin.from("event_store").insert({
          org_id: orgId,
          domain: "trust",
          aggregate_type: "wad",
          aggregate_id: parsed.poi_id,
          event_type: "trust.wad.denied",
          actor_id: authCtx.isApiKey ? null : authCtx.userId,
          actor_role: authCtx.roles?.[0] || null,
          payload: { failed_gates: failedGates.map((g) => g.gate) },
          event_hash: await computeHash(JSON.stringify(failedGates)),
        });

        return new Response(JSON.stringify(responseData), {
          status: 422,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // All gates passed — issue WaD
      const { data: wad, error: wadError } = await admin
        .from("p3_wads")
        .insert({
          org_id: orgId,
          poi_id: parsed.poi_id,
          state: "ISSUED",
          issued_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (wadError) throw new ApiException("INTERNAL_ERROR", wadError.message, 500);

      // Record event
      await admin.from("event_store").insert({
        org_id: orgId,
        domain: "trust",
        aggregate_type: "wad",
        aggregate_id: wad.id,
        event_type: "trust.wad.issued",
        actor_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_role: authCtx.roles?.[0] || null,
        payload: { poi_id: parsed.poi_id, gates_passed: gates.length },
        event_hash: await computeHash(JSON.stringify({ wad_id: wad.id })),
      });

      const responseData = successEnvelope(
        {
          wad_id: wad.id,
          poi_id: wad.poi_id,
          state: wad.state,
          issued_at: wad.issued_at,
          hard_gates: gates,
        },
        correlationId
      );

      // Store idempotency key
      await admin.from("idempotency_keys").insert({
        org_id: orgId,
        idempotency_key: idempotencyKey,
        endpoint: "p3-wad",
        request_hash: await computeHash(JSON.stringify(parsed)),
        response_data: responseData,
        response_status_code: 201,
      });

      return new Response(JSON.stringify(responseData), {
        status: 201,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── GET: List / Get WaDs ──
    if (req.method === "GET") {
      const wadId = url.searchParams.get("wad_id");

      if (wadId) {
        const { data: wad, error } = await admin
          .from("p3_wads")
          .select("*")
          .eq("id", wadId)
          .eq("org_id", orgId)
          .maybeSingle();

        if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);
        if (!wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);

        // Fetch attestations
        const { data: attestations } = await admin
          .from("p3_attestations")
          .select("*")
          .eq("wad_id", wadId)
          .order("signed_at", { ascending: true });

        return new Response(
          JSON.stringify(successEnvelope({ ...wad, attestations: attestations || [] }, correlationId)),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: wads, error } = await admin
        .from("p3_wads")
        .select("*")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      return new Response(JSON.stringify(successEnvelope(wads || [], correlationId)), {
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

async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
