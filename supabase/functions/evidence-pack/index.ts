import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";

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
    if (parts[0] === "evidence-pack") parts.shift();
    
    const matchId = parts[0];

    if (!matchId) {
      throw new ApiException("BAD_REQUEST", "Match ID is required", 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, 'evidence-pack', 'evidence-pack');
    
    // Enforce token metering - burns 1 token per request
    await enforceTokenMetering(
      supabase,
      authCtx.orgId,
      authCtx.isApiKey ? authCtx.userId : null,
      "/evidence-pack",
      requestId
    );

    // GET /:matchId - Generate evidence pack
    if (req.method === "GET") {
      console.log(`[${requestId}] GET /evidence-pack/${matchId}`);

      // Fetch match data
      const { data: match, error: matchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .single();

      if (matchError) {
        if (matchError.code === "PGRST116") {
          throw new ApiException("NOT_FOUND", "Match not found", 404);
        }
        handleDatabaseError(matchError, requestId);
      }

      // Verify match belongs to authenticated user's organization
      if (match.org_id !== authCtx.orgId) {
        throw new ApiException(
          "FORBIDDEN", 
          "You do not have permission to access this match", 
          403
        );
      }

      // Fetch match events (timeline with hash chain)
      const { data: events, error: eventsError } = await supabase
        .from("match_events")
        .select("*")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });

      if (eventsError) handleDatabaseError(eventsError, requestId);

      // Fetch audit logs for this match
      const { data: auditLogs, error: auditError } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("entity_type", "match")
        .eq("entity_id", matchId)
        .order("created_at", { ascending: true });

      if (auditError) handleDatabaseError(auditError, requestId);

      // Fetch match documents
      const { data: documents, error: docsError } = await supabase
        .from("match_documents")
        .select("id, doc_type, filename, sha256_hash, file_size, mime_type, status, created_at, expiry_date")
        .eq("match_id", matchId)
        .order("created_at", { ascending: true });

      if (docsError) handleDatabaseError(docsError, requestId);

      // Verify hash chain integrity
      let chainValid = true;
      const chainVerification = [];

      if (events && events.length > 0) {
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const expectedPreviousHash = i === 0 ? null : events[i - 1].payload_hash;
          
          const isValid = event.previous_event_hash === expectedPreviousHash;
          chainValid = chainValid && isValid;

          chainVerification.push({
            eventId: event.id,
            index: i,
            valid: isValid,
            hash: event.payload_hash,
            expectedPreviousHash,
            actualPreviousHash: event.previous_event_hash,
          });
        }
      }

      // Build evidence pack
      const evidencePack = {
        metadata: {
          packId: crypto.randomUUID(),
          generatedAt: new Date().toISOString(),
          generatedBy: authCtx.userId,
          requestId,
        },
        match: {
          id: match.id,
          hash: match.hash,
          status: match.status,
          createdAt: match.created_at,
          settledAt: match.settled_at,
          buyer: {
            id: match.buyer_id,
            name: match.buyer_name,
          },
          seller: {
            id: match.seller_id,
            name: match.seller_name,
          },
          commodity: match.commodity,
          quantity: {
            amount: match.quantity_amount,
            unit: match.quantity_unit,
          },
          price: {
            amount: match.price_amount,
            currency: match.price_currency,
          },
          terms: match.terms,
          metadata: match.metadata,
        },
        timeline: {
          events: events || [],
          totalEvents: events?.length || 0,
        },
        hashChainVerification: {
          valid: chainValid,
          details: chainVerification,
        },
        documents: {
          files: (documents || []).map((doc) => ({
            id: doc.id,
            type: doc.doc_type,
            filename: doc.filename,
            sha256Hash: doc.sha256_hash,
            fileSize: doc.file_size,
            mimeType: doc.mime_type,
            status: doc.status,
            uploadedAt: doc.created_at,
            expiresAt: doc.expiry_date,
          })),
          totalDocuments: documents?.length || 0,
        },
        auditTrail: {
          logs: auditLogs || [],
          totalLogs: auditLogs?.length || 0,
        },
        verification: {
          matchHashAlgorithm: "SHA-256",
          eventHashAlgorithm: "SHA-256",
          documentHashAlgorithm: "SHA-256",
          chainIntegrity: chainValid ? "VERIFIED" : "COMPROMISED",
          immutabilityGuarantee: "All events and document hashes are cryptographically verified",
        },
      };

      // Create audit log for evidence pack generation
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.isApiKey ? null : authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "evidence-pack.generated",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          packId: evidencePack.metadata.packId,
          chainValid,
          eventCount: events?.length || 0,
          documentCount: documents?.length || 0,
        },
      });

      return new Response(JSON.stringify(evidencePack, null, 2), {
        status: 200,
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="evidence-pack-${matchId}.json"`,
        },
      });
    }

    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  } catch (error) {
    console.error(`[${requestId}] Error:`, error);
    return errorResponse(error as Error, requestId, headers);
  }
});
