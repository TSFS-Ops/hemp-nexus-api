import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { ApiException } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

/**
 * Governance Documents Edge Function — V3 Sprint 3
 *
 * POST: Submit governance document for a deal, validates against registry.
 *       Burns tokens when validated (fixed_token_burn_amount from registry).
 * GET:  List governance documents for an org.
 * PATCH: Validate a governance document (compliance/admin role required).
 */

const GovDocCreateSchema = z.object({
  registry_id: z.string().uuid(),
  deal_reference_id: z.string().uuid(),
  deal_reference_type: z.enum(["poi", "wad"]),
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

    // ── POST: Submit governance document ──
    if (req.method === "POST") {
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

      const { data: govDoc, error } = await admin
        .from("governance_documents")
        .insert({
          org_id: orgId,
          registry_id: parsed.registry_id,
          deal_reference_id: parsed.deal_reference_id,
          deal_reference_type: parsed.deal_reference_type,
          status: "pending",
        })
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

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

      return new Response(
        JSON.stringify(successEnvelope(govDoc, correlationId)),
        { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

      const body = await req.json();
      const parsed = GovDocValidateSchema.parse(body);

      const { data: govDoc } = await admin
        .from("governance_documents")
        .select("*, governance_doc_registry!inner(fixed_token_burn_amount, doc_type)")
        .eq("id", parsed.governance_doc_id)
        .maybeSingle();

      if (!govDoc) throw new ApiException("NOT_FOUND", "Governance document not found", 404);
      if (govDoc.status === "validated") {
        throw new ApiException("CONFLICT", "Document already validated", 409);
      }

      const burnAmount = (govDoc as any).governance_doc_registry?.fixed_token_burn_amount || 0;

      // Token burn if required
      if (burnAmount > 0) {
        const { data: wallet } = await admin
          .from("token_wallets")
          .select("balance")
          .eq("org_id", govDoc.org_id)
          .maybeSingle();

        if (!wallet || wallet.balance < burnAmount) {
          throw new ApiException(
            "INSUFFICIENT_TOKENS",
            `Token burn requires ${burnAmount} tokens. Balance: ${wallet?.balance || 0}`,
            422
          );
        }

        // Deduct tokens
        await admin
          .from("token_wallets")
          .update({ balance: wallet.balance - burnAmount })
          .eq("org_id", govDoc.org_id);

        // Record token transaction
        await admin.from("token_transactions").insert({
          org_id: govDoc.org_id,
          amount: -burnAmount,
          balance_before: wallet.balance,
          type: "governance_burn",
          governance_doc_id: govDoc.id,
          idempotency_key: `gov-burn-${govDoc.id}`,
          description: `Token burn for governance document: ${(govDoc as any).governance_doc_registry?.doc_type}`,
        });
      }

      // Mark as validated
      const { data: updated, error } = await admin
        .from("governance_documents")
        .update({
          status: "validated",
          validated_at: new Date().toISOString(),
          token_burned: burnAmount > 0,
        })
        .eq("id", parsed.governance_doc_id)
        .select()
        .single();

      if (error) throw new ApiException("INTERNAL_ERROR", error.message, 500);

      // Record event
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

      return new Response(
        JSON.stringify(successEnvelope({ ...updated, token_burned_amount: burnAmount }, correlationId)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
