import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const ATTESTATION_TEXT = "I confirm this is not a contract. No payment. No obligation. This is a record that intent was confirmed.";

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
    
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, 'wad', 'wad');

    // POST /wad - Create WaD from POI
    if (req.method === "POST" && parts.length === 0) {
      const body = await req.json();
      const { poi_id } = body;

      if (!poi_id) {
        throw new ApiException("VALIDATION_ERROR", "POI ID is required", 400);
      }

      // Fetch POI (match) data
      const { data: poi, error: poiError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", poi_id)
        .single();

      if (poiError || !poi) {
        throw new ApiException("NOT_FOUND", "POI not found", 404);
      }

      // Check user is party to POI
      const userOrgId = authCtx.orgId;
      const isParty = poi.org_id === userOrgId || 
                      poi.buyer_org_id === userOrgId || 
                      poi.seller_org_id === userOrgId;

      if (!isParty && !authCtx.roles.includes('admin')) {
        throw new ApiException("FORBIDDEN", "Not authorized to create WaD for this POI", 403);
      }

      // Check POI is settled/confirmed
      if (poi.status !== "settled") {
        throw new ApiException("VALIDATION_ERROR", "POI must be confirmed before creating WaD", 400);
      }

      // Check if WaD already exists for this POI
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

      // Fetch documents for this POI
      const { data: documents } = await supabase
        .from("match_documents")
        .select("id, sha256_hash, doc_type, filename, title, status")
        .eq("match_id", poi_id)
        .neq("status", "revoked");

      // Fetch match events for evidence
      const { data: events } = await supabase
        .from("match_events")
        .select("*")
        .eq("match_id", poi_id)
        .order("created_at", { ascending: true });

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
        documents: (documents || []).map(d => ({
          id: d.id,
          sha256_hash: d.sha256_hash,
          doc_type: d.doc_type,
          title: d.title || d.filename,
          status: d.status,
        })),
        event_count: events?.length || 0,
        event_hashes: (events || []).map(e => e.payload_hash),
      };

      // Get previous ledger entry hash
      const { data: prevWad } = await supabase
        .from("wads")
        .select("ledger_entry_hash")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Create WaD
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
          created_by: authCtx.isApiKey ? null : authCtx.userId,
        })
        .select()
        .single();

      if (wadError) handleDatabaseError(wadError, requestId);

      // Create audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "wad.created",
        entity_type: "wad",
        entity_id: wad.id,
        metadata: { poi_id, request_id: requestId },
      });

      console.log(`[${requestId}] WaD created: ${wad.id} for POI ${poi_id}`);

      return new Response(JSON.stringify(wad), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // GET /wad/:wadId - Get WaD details
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

      // Check authorization
      const userOrgId = authCtx.orgId;
      const isParty = wad.org_id === userOrgId || 
                      wad.buyer_org_id === userOrgId || 
                      wad.seller_org_id === userOrgId;

      if (!isParty && !authCtx.roles.includes('admin')) {
        throw new ApiException("FORBIDDEN", "Not authorized to view this WaD", 403);
      }

      // Log admin access
      if (authCtx.roles.includes('admin') && !isParty) {
        await supabase.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
          action: "admin.wad.accessed",
          entity_type: "wad",
          entity_id: wadId,
          metadata: { request_id: requestId },
        });
      }

      // Fetch attestations
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

    // POST /wad/:wadId/attest - Add attestation
    if (req.method === "POST" && parts.length === 2 && parts[1] === "attest") {
      const wadId = parts[0];
      const body = await req.json();
      const { attested_name, role } = body;

      if (!attested_name || !role) {
        throw new ApiException("VALIDATION_ERROR", "attested_name and role are required", 400);
      }

      if (!["buyer_signatory", "seller_signatory", "witness", "admin"].includes(role)) {
        throw new ApiException("VALIDATION_ERROR", "Invalid role", 400);
      }

      // Fetch WaD
      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (wad.status === "sealed") {
        throw new ApiException("VALIDATION_ERROR", "Cannot attest to sealed WaD", 400);
      }

      if (wad.status === "revoked") {
        throw new ApiException("VALIDATION_ERROR", "Cannot attest to revoked WaD", 400);
      }

      // Check authorization based on role
      const userOrgId = authCtx.orgId;
      if (role === "buyer_signatory" && wad.buyer_org_id !== userOrgId) {
        throw new ApiException("FORBIDDEN", "Not authorized as buyer signatory", 403);
      }
      if (role === "seller_signatory" && wad.seller_org_id !== userOrgId) {
        throw new ApiException("FORBIDDEN", "Not authorized as seller signatory", 403);
      }

      // Create attestation
      const { data: attestation, error: attError } = await supabase
        .from("wad_attestations")
        .insert({
          wad_id: wadId,
          user_id: authCtx.userId,
          org_id: userOrgId,
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

      // Update WaD status if first attestation
      if (wad.status === "draft") {
        await supabase
          .from("wads")
          .update({ status: "awaiting_attestations" })
          .eq("id", wadId);
      }

      // Update signatory reference
      const updateFields: Record<string, unknown> = {};
      if (role === "buyer_signatory") {
        updateFields.buyer_signatory_user_id = authCtx.userId;
      } else if (role === "seller_signatory") {
        updateFields.seller_signatory_user_id = authCtx.userId;
      }

      if (Object.keys(updateFields).length > 0) {
        await supabase.from("wads").update(updateFields).eq("id", wadId);
      }

      // Create audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        action: "wad.attested",
        entity_type: "wad",
        entity_id: wadId,
        metadata: { role, request_id: requestId },
      });

      console.log(`[${requestId}] WaD ${wadId} attested by ${authCtx.userId} as ${role}`);

      return new Response(JSON.stringify(attestation), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // POST /wad/:wadId/seal - Seal the WaD
    if (req.method === "POST" && parts.length === 2 && parts[1] === "seal") {
      const wadId = parts[0];

      // Fetch WaD
      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (wad.status === "sealed") {
        throw new ApiException("VALIDATION_ERROR", "WaD is already sealed", 400);
      }

      if (wad.status === "revoked") {
        throw new ApiException("VALIDATION_ERROR", "Cannot seal revoked WaD", 400);
      }

      // Check user is party
      const userOrgId = authCtx.orgId;
      const isParty = wad.org_id === userOrgId || 
                      wad.buyer_org_id === userOrgId || 
                      wad.seller_org_id === userOrgId;

      if (!isParty && !authCtx.roles.includes('admin')) {
        throw new ApiException("FORBIDDEN", "Not authorized to seal this WaD", 403);
      }

      // Fetch attestations
      const { data: attestations } = await supabase
        .from("wad_attestations")
        .select("*")
        .eq("wad_id", wadId);

      // Check required attestations (buyer + seller)
      const hasBuyerAttestation = attestations?.some(a => a.role === "buyer_signatory");
      const hasSellerAttestation = attestations?.some(a => a.role === "seller_signatory");

      if (!hasBuyerAttestation || !hasSellerAttestation) {
        throw new ApiException("VALIDATION_ERROR", "Both buyer and seller must attest before sealing", 400);
      }

      // Fetch documents
      const { data: documents } = await supabase
        .from("match_documents")
        .select("id, sha256_hash, doc_type")
        .eq("match_id", wad.poi_id)
        .neq("status", "revoked");

      // Build canonical payload
      const canonicalPayload = buildCanonicalPayload(wad, attestations || [], documents || []);
      const sealHash = await generateHash(canonicalPayload);

      // Generate ledger entry hash
      const ledgerEntryHash = await generateHash({
        prev: wad.prev_ledger_entry_hash,
        seal: sealHash,
        timestamp: new Date().toISOString(),
      });

      // Update WaD
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

      // Create audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        action: "wad.sealed",
        entity_type: "wad",
        entity_id: wadId,
        metadata: { seal_hash: sealHash, request_id: requestId },
      });

      console.log(`[${requestId}] WaD ${wadId} sealed with hash ${sealHash}`);

      return new Response(JSON.stringify(sealedWad), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // POST /wad/:wadId/revoke - Revoke WaD (admin only)
    if (req.method === "POST" && parts.length === 2 && parts[1] === "revoke") {
      const wadId = parts[0];
      const body = await req.json();
      const { reason } = body;

      if (!reason) {
        throw new ApiException("VALIDATION_ERROR", "Revocation reason is required", 400);
      }

      if (!authCtx.roles.includes('admin')) {
        throw new ApiException("FORBIDDEN", "Only admins can revoke WaDs", 403);
      }

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (wad.status === "revoked") {
        throw new ApiException("VALIDATION_ERROR", "WaD is already revoked", 400);
      }

      const { data: revokedWad, error: revokeError } = await supabase
        .from("wads")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          revoked_by: authCtx.userId,
          revoked_reason: reason,
        })
        .eq("id", wadId)
        .select()
        .single();

      if (revokeError) handleDatabaseError(revokeError, requestId);

      // Create audit log
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        action: "wad.revoked",
        entity_type: "wad",
        entity_id: wadId,
        metadata: { reason, request_id: requestId },
      });

      console.log(`[${requestId}] WaD ${wadId} revoked: ${reason}`);

      return new Response(JSON.stringify(revokedWad), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // GET /wad/:wadId/certificate - Download certificate (returns JSON certificate data)
    if (req.method === "GET" && parts.length === 2 && parts[1] === "certificate") {
      const wadId = parts[0];

      const { data: wad, error: wadError } = await supabase
        .from("wads")
        .select("*")
        .eq("id", wadId)
        .single();

      if (wadError || !wad) {
        throw new ApiException("NOT_FOUND", "WaD not found", 404);
      }

      if (wad.status !== "sealed") {
        throw new ApiException("VALIDATION_ERROR", "Certificate only available for sealed WaDs", 400);
      }

      // Check authorization
      const userOrgId = authCtx.orgId;
      const isParty = wad.org_id === userOrgId || 
                      wad.buyer_org_id === userOrgId || 
                      wad.seller_org_id === userOrgId;

      if (!isParty && !authCtx.roles.includes('admin')) {
        throw new ApiException("FORBIDDEN", "Not authorized to download this certificate", 403);
      }

      // Fetch attestations
      const { data: attestations } = await supabase
        .from("wad_attestations")
        .select("*")
        .eq("wad_id", wadId);

      // Fetch POI
      const { data: poi } = await supabase
        .from("matches")
        .select("*")
        .eq("id", wad.poi_id)
        .single();

      // Build certificate data
      const certificate = {
        certificate_type: "WaD_Certificate",
        version: "1.0",
        wad_id: wad.id,
        poi_id: wad.poi_id,
        seal_hash: wad.seal_hash,
        sealed_at: wad.sealed_at,
        ledger_entry_hash: wad.ledger_entry_hash,
        parties: {
          buyer: {
            org_id: wad.buyer_org_id,
            name: poi?.buyer_name,
          },
          seller: {
            org_id: wad.seller_org_id,
            name: poi?.seller_name,
          },
        },
        transaction_summary: {
          commodity: poi?.commodity,
          quantity: `${poi?.quantity_amount} ${poi?.quantity_unit}`,
          price: `${poi?.price_currency} ${poi?.price_amount}`,
          confirmed_at: poi?.settled_at,
        },
        attestations: (attestations || []).map(a => ({
          role: a.role,
          attested_name: a.attested_name,
          attested_at: a.attested_at,
          attestation_text: a.attestation_text,
        })),
        evidence_bundle_hash: await generateHash(wad.evidence_bundle),
        disclaimer: "This is NOT a contract. No payment. No obligation. This is an evidence-grade record that intent was confirmed.",
        generated_at: new Date().toISOString(),
      };

      // Log download
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        action: authCtx.roles.includes('admin') && !isParty ? "admin.wad.certificate.downloaded" : "wad.downloaded",
        entity_type: "wad",
        entity_id: wadId,
        metadata: { request_id: requestId },
      });

      return new Response(JSON.stringify(certificate, null, 2), {
        status: 200,
        headers: { 
          ...headers, 
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="wad-certificate-${wadId}.json"`,
        },
      });
    }

    // GET /wad - List WaDs for org (or all for admin)
    if (req.method === "GET" && parts.length === 0) {
      const isAdmin = authCtx.roles.includes('admin');
      const poiId = url.searchParams.get("poi_id");
      const status = url.searchParams.get("status");

      let query = supabase.from("wads").select("*");

      if (!isAdmin) {
        // Filter by org
        query = query.or(`org_id.eq.${authCtx.orgId},buyer_org_id.eq.${authCtx.orgId},seller_org_id.eq.${authCtx.orgId}`);
      }

      if (poiId) {
        query = query.eq("poi_id", poiId);
      }

      if (status) {
        query = query.eq("status", status);
      }

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
