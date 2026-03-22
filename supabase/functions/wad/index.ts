import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { PDFDocument, StandardFonts, rgb, grayscale } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { deriveActorIds } from "../_shared/actor-context.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { validateInput } from "../_shared/validation.ts";

const ATTESTATION_TEXT = "I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.";

// Validation schemas
const wadCreateSchema = z.object({
  poi_id: z.string().uuid(),
});

const attestSchema = z.object({
  attested_name: z.string().trim().min(1).max(200),
  role: z.enum(["buyer_signatory", "seller_signatory", "witness", "admin"]),
});

const revokeSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

// Generate deterministic hash of payload
async function generateHash(payload: unknown): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Build canonical payload for hashing
function buildCanonicalPayload(wad: any, attestations: any[], documents: any[]): object {
  return {
    wad_id: wad.id,
    poi_id: wad.poi_id,
    parties: {
      buyer_org_id: wad.buyer_org_id,
      seller_org_id: wad.seller_org_id,
    },
    attestations: attestations.map(a => ({
      user_id: a.user_id,
      org_id: a.org_id,
      role: a.role,
      attested_name: a.attested_name,
      attested_at: a.attested_at,
    })),
    documents: documents.map(d => ({
      id: d.id,
      sha256_hash: d.sha256_hash,
      doc_type: d.doc_type,
    })),
    evidence_bundle: wad.evidence_bundle,
    created_at: wad.created_at,
  };
}

// Check if user has admin/platform_admin role
function isAdmin(authCtx: { roles: string[] }): boolean {
  return authCtx.roles.includes("admin") || authCtx.roles.includes("platform_admin");
}

// Check if user is a party to the WaD
function isPartyToWad(wad: any, orgId: string): boolean {
  return wad.org_id === orgId || wad.buyer_org_id === orgId || wad.seller_org_id === orgId;
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const url = new URL(req.url);
    const rawParts = url.pathname.split("/").filter(Boolean);
    
    // Normalize path
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "wad") parts.shift();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);
    
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, "wad", "wad");

    console.log(`[${requestId}] ${req.method} /wad${parts.length ? "/" + parts.join("/") : ""} org:${authCtx.orgId}`);

    // Helper: write audit log
    const writeAuditLog = async (action: string, entityId: string, metadata: Record<string, unknown> = {}) => {
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action,
        entity_type: "wad",
        entity_id: entityId,
        metadata: { ...metadata, request_id: requestId },
      });
    };

    // ── POST /wad ── Create WaD from POI
    if (req.method === "POST" && parts.length === 0) {
      const body = await req.json();
      const { poi_id } = validateInput(wadCreateSchema, body);

      // Fetch POI (match) data
      const { data: poi, error: poiError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", poi_id)
        .single();

      if (poiError || !poi) {
        throw new ApiException("NOT_FOUND", "POI not found", 404);
      }

      const userOrgId = authCtx.orgId;
      const partyCheck = poi.org_id === userOrgId || poi.buyer_org_id === userOrgId || poi.seller_org_id === userOrgId;
      if (!partyCheck && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to create WaD for this POI", 403);
      }

      if (poi.status !== "settled") {
        throw new ApiException("VALIDATION_ERROR", "POI must be confirmed before creating WaD", 400);
      }

      // ── Hard-gate: POI state must be COLLAPSED ──
      if (poi.poi_state !== "COLLAPSED") {
        throw new ApiException("HARD_GATE_FAILED", `POI state must be COLLAPSED, currently: ${poi.poi_state}`, 422);
      }

      // ── Hard-gate: Screening recentness (within 30 days) + risk_band checks ──
      const partyOrgIds = [poi.buyer_org_id, poi.seller_org_id].filter(Boolean);
      for (const partyOrgId of partyOrgIds) {
        // Check latest screening is within 30 days
        const { data: latestScreening } = await supabase
          .from("screening_results")
          .select("status, screened_at")
          .eq("org_id", partyOrgId)
          .order("screened_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestScreening) {
          throw new ApiException("HARD_GATE_FAILED", `No screening results found for org ${partyOrgId}. WaD denied.`, 422);
        }

        const screenedAt = new Date(latestScreening.screened_at);
        const daysSinceScreening = (Date.now() - screenedAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceScreening > 30) {
          throw new ApiException(
            "HARD_GATE_FAILED",
            `Screening for org ${partyOrgId} is ${Math.floor(daysSinceScreening)} days old. Must be rescreened within 30 days. WaD denied.`,
            422
          );
        }

        if (latestScreening.status !== "clear") {
          throw new ApiException("HARD_GATE_FAILED", `Screening status for org ${partyOrgId} is '${latestScreening.status}', not 'clear'. WaD denied.`, 422);
        }

        // Check risk_band is not 'critical' or 'high'
        const { data: riskScore } = await supabase
          .from("dd_risk_scores")
          .select("risk_band, score")
          .eq("org_id", partyOrgId)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (riskScore && ["critical", "high"].includes(riskScore.risk_band)) {
          throw new ApiException(
            "HARD_GATE_FAILED",
            `Risk band for org ${partyOrgId} is '${riskScore.risk_band}' (score: ${riskScore.score}). WaD denied.`,
            422
          );
        }
      }

      // Check if active WaD already exists
      const { data: existingWad } = await supabase
        .from("wads")
        .select("id, status")
        .eq("poi_id", poi_id)
        .neq("status", "revoked")
        .neq("status", "superseded")
        .maybeSingle();

      if (existingWad) {
        throw new ApiException("CONFLICT", "Active WaD already exists for this POI", 409);
      }

      // Fetch documents + events in parallel
      const [docsResult, eventsResult] = await Promise.all([
        supabase
          .from("match_documents")
          .select("id, sha256_hash, doc_type, filename, title, status")
          .eq("match_id", poi_id)
          .neq("status", "revoked"),
        supabase
          .from("match_events")
          .select("*")
          .eq("match_id", poi_id)
          .order("created_at", { ascending: true }),
      ]);

      const documents = docsResult.data || [];
      const events = eventsResult.data || [];

      // Build evidence bundle
      const evidenceBundle = {
        poi_snapshot: {
          id: poi.id,
          hash: poi.hash,
          commodity: poi.commodity,
          quantity: { amount: poi.quantity_amount, unit: poi.quantity_unit },
          price: { amount: poi.price_amount, currency: poi.price_currency },
          terms: poi.terms,
          buyer: { id: poi.buyer_id, name: poi.buyer_name, org_id: poi.buyer_org_id },
          seller: { id: poi.seller_id, name: poi.seller_name, org_id: poi.seller_org_id },
          created_at: poi.created_at,
          settled_at: poi.settled_at,
        },
        documents: documents.map(d => ({
          id: d.id,
          sha256_hash: d.sha256_hash,
          doc_type: d.doc_type,
          title: d.title || d.filename,
          status: d.status,
        })),
        event_count: events.length,
        event_hashes: events.map(e => e.payload_hash),
      };

      // Get previous ledger entry hash
      const { data: prevWad } = await supabase
        .from("wads")
        .select("ledger_entry_hash")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .insert({
          poi_id,
          org_id: poi.org_id,
          buyer_org_id: poi.buyer_org_id,
          seller_org_id: poi.seller_org_id,
          evidence_bundle: evidenceBundle,
          canonical_payload_json: {},
          prev_ledger_entry_hash: prevWad?.ledger_entry_hash || null,
          created_by: actorUserId,
        })
        .select()
        .single();

      if (wadError) handleDatabaseError(wadError, requestId);

      await writeAuditLog("wad.created", wad.id, { poi_id });

      return new Response(JSON.stringify(wad), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── GET /wad/:wadId ── Get WaD details
    if (req.method === "GET" && parts.length === 1) {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to view this WaD", 403);
      }

      // Log admin access
      if (isAdmin(authCtx) && !isPartyToWad(wad, authCtx.orgId)) {
        await writeAuditLog("admin.wad.accessed", wadId);
      }

      const { data: attestations } = await supabase
        .from("wad_attestations")
        .select("*")
        .eq("wad_id", wadId)
        .order("attested_at", { ascending: true });

      return new Response(JSON.stringify({ ...wad, attestations: attestations || [] }), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /wad/:wadId/attest ── Add attestation
    if (req.method === "POST" && parts.length === 2 && parts[1] === "attest") {
      const wadId = parts[0];
      const body = await req.json();
      const { attested_name, role } = validateInput(attestSchema, body);

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (wad.status === "sealed") throw new ApiException("INVALID_STATE", "Cannot attest to sealed WaD", 400);
      if (wad.status === "revoked") throw new ApiException("INVALID_STATE", "Cannot attest to revoked WaD", 400);

      // Check role authorisation
      if (role === "buyer_signatory" && wad.buyer_org_id !== authCtx.orgId) {
        throw new ApiException("FORBIDDEN", "Not authorised as buyer signatory", 403);
      }
      if (role === "seller_signatory" && wad.seller_org_id !== authCtx.orgId) {
        throw new ApiException("FORBIDDEN", "Not authorised as seller signatory", 403);
      }

      const { data: attestation, error: attError } = await supabase
        .from("wad_attestations")
        .insert({
          wad_id: wadId,
          user_id: actorUserId || authCtx.userId,
          org_id: authCtx.orgId,
          role,
          attested_name,
          attestation_text: ATTESTATION_TEXT,
          ip_address: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
          user_agent: req.headers.get("user-agent"),
        })
        .select()
        .single();

      if (attError) {
        if (attError.code === "23505") {
          throw new ApiException("CONFLICT", "Already attested to this WaD", 409);
        }
        handleDatabaseError(attError, requestId);
      }

      // Update WaD status + signatory ref
      const updateFields: Record<string, unknown> = {};
      if (wad.status === "draft") updateFields.status = "awaiting_attestations";
      if (role === "buyer_signatory") updateFields.buyer_signatory_user_id = actorUserId || authCtx.userId;
      if (role === "seller_signatory") updateFields.seller_signatory_user_id = actorUserId || authCtx.userId;

      if (Object.keys(updateFields).length > 0) {
        await supabase.from("wads").update(updateFields).eq("id", wadId);
      }

      await writeAuditLog("wad.attested", wadId, { role });

      return new Response(JSON.stringify(attestation), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /wad/:wadId/seal ── Seal the WaD
    if (req.method === "POST" && parts.length === 2 && parts[1] === "seal") {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.status === "sealed") throw new ApiException("INVALID_STATE", "WaD is already sealed", 400);
      if (wad.status === "revoked") throw new ApiException("INVALID_STATE", "Cannot seal revoked WaD", 400);

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to seal this WaD", 403);
      }

      // Fetch attestations + documents in parallel
      const [attResult, docResult] = await Promise.all([
        supabase.from("wad_attestations").select("*").eq("wad_id", wadId),
        supabase.from("match_documents").select("id, sha256_hash, doc_type").eq("match_id", wad.poi_id).neq("status", "revoked"),
      ]);

      const attestations = attResult.data || [];
      const documents = docResult.data || [];

      const hasBuyer = attestations.some(a => a.role === "buyer_signatory");
      const hasSeller = attestations.some(a => a.role === "seller_signatory");
      if (!hasBuyer || !hasSeller) {
        throw new ApiException("VALIDATION_ERROR", "Both buyer and seller must attest before sealing", 400);
      }

      const canonicalPayload = buildCanonicalPayload(wad, attestations, documents);
      const sealHash = await generateHash(canonicalPayload);
      const ledgerEntryHash = await generateHash({
        prev: wad.prev_ledger_entry_hash,
        seal: sealHash,
        timestamp: new Date().toISOString(),
      });

      const { data: sealedWad, error: sealError } = await supabase
        .from("wads")
        .update({
          status: "sealed",
          canonical_payload_json: canonicalPayload,
          seal_hash: sealHash,
          sealed_at: new Date().toISOString(),
          ledger_entry_hash: ledgerEntryHash,
        })
        .eq("id", wadId)
        .select()
        .single();

      if (sealError) handleDatabaseError(sealError, requestId);

      await writeAuditLog("wad.sealed", wadId, { seal_hash: sealHash });

      return new Response(JSON.stringify(sealedWad), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── POST /wad/:wadId/revoke ── Revoke WaD (admin only)
    if (req.method === "POST" && parts.length === 2 && parts[1] === "revoke") {
      const wadId = parts[0];
      const body = await req.json();
      const { reason } = validateInput(revokeSchema, body);

      if (!isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Only admins can revoke WaDs", 403);
      }

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.status === "revoked") throw new ApiException("INVALID_STATE", "WaD is already revoked", 400);

      const { data: revokedWad, error: revokeError } = await supabase
        .from("wads")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: actorUserId,
          revoked_reason: reason,
        })
        .eq("id", wadId)
        .select()
        .single();

      if (revokeError) handleDatabaseError(revokeError, requestId);

      await writeAuditLog("wad.revoked", wadId, { reason });

      return new Response(JSON.stringify(revokedWad), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ── GET /wad/:wadId/certificate ── Download certificate
    if (req.method === "GET" && parts.length === 2 && parts[1] === "certificate") {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) throw new ApiException("NOT_FOUND", "WaD not found", 404);
      if (wad.status !== "sealed") throw new ApiException("VALIDATION_ERROR", "Certificate only available for sealed WaDs", 400);

      if (!isPartyToWad(wad, authCtx.orgId) && !isAdmin(authCtx)) {
        throw new ApiException("FORBIDDEN", "Not authorised to download this certificate", 403);
      }

      // Fetch attestations + POI in parallel
      const [attResult, poiResult] = await Promise.all([
        supabase.from("wad_attestations").select("*").eq("wad_id", wadId),
        supabase.from("matches").select("*").eq("id", wad.poi_id).single(),
      ]);

      const attestations = attResult.data || [];
      const poi = poiResult.data;

      const certificate = {
        certificate_type: "WaD_Certificate",
        version: "1.0",
        wad_id: wad.id,
        poi_id: wad.poi_id,
        seal_hash: wad.seal_hash,
        sealed_at: wad.sealed_at,
        ledger_entry_hash: wad.ledger_entry_hash,
        parties: {
          buyer: { org_id: wad.buyer_org_id, name: poi?.buyer_name },
          seller: { org_id: wad.seller_org_id, name: poi?.seller_name },
        },
        transaction_summary: {
          commodity: poi?.commodity,
          quantity: `${poi?.quantity_amount} ${poi?.quantity_unit}`,
          price: `${poi?.price_currency} ${poi?.price_amount}`,
          confirmed_at: poi?.settled_at,
        },
        attestations: attestations.map(a => ({
          role: a.role,
          attested_name: a.attested_name,
          attested_at: a.attested_at,
          attestation_text: a.attestation_text,
        })),
        evidence_bundle_hash: await generateHash(wad.evidence_bundle),
        disclaimer: "This is NOT a contract. No payment. No obligation. This is an evidence-grade record that intent was confirmed.",
        generated_at: new Date().toISOString(),
      };

      const auditAction = isAdmin(authCtx) && !isPartyToWad(wad, authCtx.orgId)
        ? "admin.wad.certificate.downloaded"
        : "wad.downloaded";
      await writeAuditLog(auditAction, wadId);

      return new Response(JSON.stringify(certificate, null, 2), {
        status: 200,
        headers: { 
          ...headers, 
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="wad-certificate-${wadId}.json"`,
        },
      });
    }

    // ── GET /wad ── List WaDs
    if (req.method === "GET" && parts.length === 0) {
      const poiId = url.searchParams.get("poi_id");
      const status = url.searchParams.get("status");

      let query = supabase.from("wads").select("*");

      if (!isAdmin(authCtx)) {
        query = query.or(`org_id.eq.${authCtx.orgId},buyer_org_id.eq.${authCtx.orgId},seller_org_id.eq.${authCtx.orgId}`);
      }

      if (poiId) query = query.eq("poi_id", poiId);
      if (status) query = query.eq("status", status);

      const { data: wads, error: wadsError } = await query.order("created_at", { ascending: false });
      if (wadsError) handleDatabaseError(wadsError, requestId);

      return new Response(JSON.stringify(wads || []), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
