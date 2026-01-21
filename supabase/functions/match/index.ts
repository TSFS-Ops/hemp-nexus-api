import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { matchSchema, validateInput } from "../_shared/validation.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { triggerWebhooks, notifyCounterpartyIntent } from "../_shared/webhooks.ts";
import { recordMatchEvent } from "../_shared/match-events.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";
import { enforceEligibility, evaluateEligibility, formatEligibilityResponse } from "../_shared/eligibility.ts";
import { deriveActorIds, getCreatedBy } from "../_shared/actor-context.ts";

// Constants for request validation
const MAX_BODY_SIZE = 1024 * 1024; // 1MB max body size
const uuidSchema = z.string().uuid();

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
    
    // Normalize path: strip optional prefixes
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "match") parts.shift();
    
    const matchId = parts[0];
    const action = parts[1]; // 'settle' if present

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate
    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireScope(authCtx, 'match');

    // Rate limiting
    await checkRateLimit(supabase, authCtx.orgId, authCtx.isApiKey ? authCtx.userId : null, 'match', 'match');
    
    // Derive actor IDs once for use throughout the request
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);
    
    // Enforce token metering - burns 1 token per request
    await enforceTokenMetering(
      supabase,
      authCtx.orgId,
      actorApiKeyId,
      "/match",
      requestId
    );

    // Route: POST /match/:id/settle (Confirm Intent - creates audit record)
    if (req.method === "POST" && matchId && action === "settle") {
      // Validate matchId is a valid UUID to prevent injection attacks
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/settle (Confirm Intent)`);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      // Verify match belongs to authenticated user's organization
      if (match.org_id !== authCtx.orgId) {
        throw new ApiException(
          "FORBIDDEN", 
          "You do not have permission to confirm intent for this match", 
          403
        );
      }

      // ELIGIBILITY CHECK - "Ambiguity = Automatic Denial"
      // Block Confirm Intent if any required field is missing or invalid
      try {
        enforceEligibility(match);
      } catch (eligibilityError) {
        // Record the denied attempt in audit log (non-proof entry)
        await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "intent.denied",
          entity_type: "match",
          entity_id: matchId,
          metadata: {
            reason: "eligibility_check_failed",
            error: eligibilityError instanceof ApiException ? eligibilityError.message : "Unknown error",
            eligibility: formatEligibilityResponse(evaluateEligibility(match)),
          }
        });
        
        console.log(`[${requestId}] Intent denied due to eligibility check failure`);
        throw eligibilityError;
      }

      // If already confirmed, return as-is (idempotent)
      if (match.status === "settled") {
        console.log(`[${requestId}] Intent already confirmed`);
        return new Response(JSON.stringify(match), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      // Update to confirmed (status remains "settled" in DB for compatibility)
      const { data: updated, error: updateError } = await supabase
        .from("matches")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .eq("id", matchId)
        .select()
        .single();

      if (updateError) handleDatabaseError(updateError, requestId);

      // Create audit log for intent confirmation (immutable proof-of-intent)
      try {
        await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "intent.confirmed",
          entity_type: "match",
          entity_id: matchId,
          metadata: {
            confirmed_at: updated.settled_at,
            hash: match.hash,
            buyer_id: match.buyer_id,
            seller_id: match.seller_id,
            commodity: match.commodity,
            quantity_amount: match.quantity_amount,
            quantity_unit: match.quantity_unit,
            price_amount: match.price_amount,
            price_currency: match.price_currency,
            note: "Intent confirmation signals interest only - no payment or legal obligation created"
          }
        });
        console.log(`[${requestId}] Audit log created for intent confirmation with hash: ${match.hash}`);

        // Record event in hash-chained timeline
        await recordMatchEvent(
          supabase,
          matchId,
          match.org_id,
          "intent.confirmed",
          {
            confirmedAt: updated.settled_at,
            hash: match.hash,
            commodity: match.commodity,
            quantityAmount: match.quantity_amount,
            priceAmount: match.price_amount,
            note: "Signals serious interest - no legal obligation"
          },
          actorUserId,
          actorApiKeyId
        );
      } catch (auditError) {
        console.error(`[${requestId}] Failed to create audit log:`, auditError);
        // Critical: audit log creation failure should fail the request
        throw new ApiException("AUDIT_LOG_ERROR", "Failed to create audit trail", 500);
      }

      console.log(`[${requestId}] Intent confirmed successfully`);
      
      // Trigger webhooks in background (using both event names for compatibility)
      triggerWebhooks(supabase, match.org_id, "intent.confirmed", {
        matchId,
        hash: match.hash,
        confirmedAt: updated.settled_at,
        commodity: match.commodity,
        quantity: match.quantity_amount,
        note: "Intent confirmation signals interest only - no payment or legal obligation"
      }).catch(err => console.error(`Webhook trigger error:`, err));

      // Also trigger legacy event name for backward compatibility
      triggerWebhooks(supabase, match.org_id, "match.settled", {
        matchId,
        hash: match.hash,
        settledAt: updated.settled_at,
        commodity: match.commodity,
        quantity: match.quantity_amount,
      }).catch(err => console.error(`Webhook trigger error:`, err));

      // Notify the counterparty about the intent confirmation
      // Determine who is confirming (buyer or seller) and who is counterparty
      notifyCounterpartyIntent(supabase, {
        matchId,
        hash: match.hash,
        confirmedAt: updated.settled_at,
        confirmingPartyId: match.buyer_id, // Assuming confirmer is buyer; could be dynamic
        confirmingPartyName: match.buyer_name,
        counterpartyId: match.seller_id,
        counterpartyName: match.seller_name,
        commodity: match.commodity,
        quantity: match.quantity_amount,
        quantityUnit: match.quantity_unit,
        priceAmount: match.price_amount,
        priceCurrency: match.price_currency,
      }).catch(err => console.error(`Counterparty notification error:`, err));

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Route: GET /match/:id
    if (req.method === "GET" && matchId && !action) {
      // Validate matchId is a valid UUID
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] GET /match/${matchId}`);

      const { data: match, error } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (error) handleDatabaseError(error, requestId);
      if (!match) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      // Verify match belongs to authenticated user's organization
      if (match.org_id !== authCtx.orgId) {
        throw new ApiException(
          "FORBIDDEN", 
          "You do not have permission to access this match", 
          403
        );
      }

      return new Response(JSON.stringify(match), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Route: GET /matches (list)
    if (req.method === "GET" && !matchId) {
      console.log(`[${requestId}] GET /matches`);

      const limit = parseInt(url.searchParams.get("limit") || "50");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const status = url.searchParams.get("status");
      const commodity = url.searchParams.get("commodity");
      const commodityType = url.searchParams.get("commodity_type");

      let query = supabase
        .from("matches")
        .select("*", { count: "exact" })
        .eq("org_id", authCtx.orgId) // Only return matches for user's org
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && (status === "matched" || status === "settled")) {
        query = query.eq("status", status);
      }

      // SECURITY: Validate and sanitize commodity search parameter
      // Only allow alphanumeric, spaces, hyphens, periods, and commas
      if (commodity) {
        const sanitizedCommodity = commodity.slice(0, 200);
        const commodityPattern = /^[a-zA-Z0-9\s\-\.,]+$/;
        if (!commodityPattern.test(sanitizedCommodity)) {
          throw new ApiException(
            "VALIDATION_ERROR", 
            "Commodity search contains invalid characters", 
            400
          );
        }
        query = query.ilike("commodity", `%${sanitizedCommodity}%`);
      }

      if (commodityType) {
        query = query.contains("metadata", { commodity_type: commodityType });
      }

      const { data: matches, error, count } = await query;

      if (error) handleDatabaseError(error, requestId);

      return new Response(
        JSON.stringify({ items: matches || [], totalCount: count || 0 }),
        { status: 200, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }

    // Route: POST /match (create new match)
    if (req.method === "POST" && !matchId) {
      console.log(`[${requestId}] POST /match`);

      // Check body size to prevent DoS attacks
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        throw new ApiException("PAYLOAD_TOO_LARGE", "Request body exceeds maximum size of 1MB", 413);
      }

      // Check for idempotency key
      const idempotencyKey = req.headers.get("idempotency-key");
      
      if (idempotencyKey) {
        // Check if this idempotency key was already processed
        const { data: existingKey, error: keyError } = await supabase
          .from("idempotency_keys")
          .select("*")
          .eq("org_id", authCtx.orgId)
          .eq("idempotency_key", idempotencyKey)
          .eq("endpoint", "POST /match")
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (keyError) {
          console.error(`[${requestId}] Error checking idempotency key:`, keyError);
        }

        if (existingKey) {
          console.log(`[${requestId}] Returning cached response for idempotency key`);
          return new Response(JSON.stringify(existingKey.response_data), {
            status: existingKey.response_status_code,
            headers: { ...headers, "Content-Type": "application/json", "X-Idempotent-Replay": "true" },
          });
        }
      }

      const rawBody = await req.json();
      
      // Validate input with zod schema
      let body;
      try {
        body = validateInput(matchSchema, rawBody);
      } catch (error) {
        throw new ApiException(
          "VALIDATION_ERROR",
          error instanceof Error ? error.message : "Invalid input",
          400
        );
      }

      // Build canonical JSON for hashing
      const canonical = {
        buyer: body.buyer,
        seller: body.seller,
        commodity: body.commodity,
        quantity: body.quantity,
        price: body.price,
        terms: body.terms,
        metadata: body.metadata || {}
      };

      // Compute SHA-256 hash
      const canonicalString = JSON.stringify(canonical);
      const encoder = new TextEncoder();
      const data = encoder.encode(canonicalString);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

      // Check for hash collision (duplicate match detection)
      const { data: existingMatch, error: hashCheckError } = await supabase
        .from("matches")
        .select("*")
        .eq("org_id", authCtx.orgId)
        .eq("hash", hash)
        .maybeSingle();

      if (hashCheckError) {
        console.error(`[${requestId}] Error checking hash collision:`, hashCheckError);
      }

      if (existingMatch) {
        console.log(`[${requestId}] Hash collision detected - returning existing match`);
        
        // Store idempotency key if provided
        if (idempotencyKey) {
          try {
            await supabase.from("idempotency_keys").insert({
              org_id: authCtx.orgId,
              idempotency_key: idempotencyKey,
              endpoint: "POST /match",
              request_hash: hash,
              response_data: existingMatch,
              response_status_code: 200,
            });
          } catch (keyError) {
            console.error(`[${requestId}] Failed to store idempotency key:`, keyError);
          }
        }

        return new Response(JSON.stringify(existingMatch), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json", "X-Match-Duplicate": "true" },
        });
      }

      // Insert match
      const { data: match, error: insertError } = await supabase
        .from("matches")
        .insert({
          org_id: authCtx.orgId,
          created_by: getCreatedBy(authCtx),
          buyer_id: body.buyer.id,
          buyer_name: body.buyer.name,
          seller_id: body.seller.id,
          seller_name: body.seller.name,
          commodity: body.commodity,
          quantity_amount: body.quantity.amount,
          quantity_unit: body.quantity.unit,
          price_amount: body.price.amount,
          price_currency: body.price.currency,
          terms: body.terms,
          metadata: body.metadata || {},
          hash,
          status: "matched"
        })
        .select()
        .single();

      if (insertError) handleDatabaseError(insertError, requestId);

      // Create audit log for match creation (immutable proof-of-intent)
      try {
        await supabase.from("audit_logs").insert({
          org_id: authCtx.orgId,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "match.created",
          entity_type: "match",
          entity_id: match.id,
          metadata: {
            hash,
            buyer_id: body.buyer.id,
            buyer_name: body.buyer.name,
            seller_id: body.seller.id,
            seller_name: body.seller.name,
            commodity: body.commodity,
            quantity_amount: body.quantity.amount,
            quantity_unit: body.quantity.unit,
            price_amount: body.price.amount,
            price_currency: body.price.currency,
            terms: body.terms,
            canonical_string: canonicalString
          }
        });
        console.log(`[${requestId}] Audit log created for match with hash: ${hash}`);

        // Record event in hash-chained timeline
        await recordMatchEvent(
          supabase,
          match.id,
          authCtx.orgId,
          "match.created",
          {
            buyer: body.buyer,
            seller: body.seller,
            commodity: body.commodity,
            quantity: body.quantity,
            price: body.price,
            terms: body.terms,
            hash,
          },
          actorUserId,
          actorApiKeyId
        );
      } catch (auditError) {
        console.error(`[${requestId}] Failed to create audit log:`, auditError);
        // Critical: audit log creation failure should fail the request
        throw new ApiException("AUDIT_LOG_ERROR", "Failed to create audit trail", 500);
      }

      // Store idempotency key if provided (non-blocking)
      if (idempotencyKey) {
        try {
          await supabase.from("idempotency_keys").insert({
            org_id: authCtx.orgId,
            idempotency_key: idempotencyKey,
            endpoint: "POST /match",
            request_hash: hash,
            response_data: match,
            response_status_code: 201,
          });
        } catch (keyError) {
          console.error(`[${requestId}] Failed to store idempotency key:`, keyError);
        }
      }

      console.log(`[${requestId}] Match created: ${match.id}`);
      
      // Trigger webhooks in background
      triggerWebhooks(supabase, authCtx.orgId, "match.created", {
        matchId: match.id,
        commodity: body.commodity,
        buyer: body.buyer,
        seller: body.seller,
        quantity: body.quantity,
        price: body.price,
        hash,
      }).catch(err => console.error(`Webhook trigger error:`, err));

      return new Response(JSON.stringify(match), {
        status: 201,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Method not allowed
    throw new ApiException("METHOD_NOT_ALLOWED", "Method not allowed", 405);

  } catch (error) {
    return errorResponse(error instanceof Error ? error : new Error("Unknown error"), requestId, headers);
  }
});