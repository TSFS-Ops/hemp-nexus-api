import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { matchSchema, validateInput } from "../_shared/validation.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";
import { recordMatchEvent } from "../_shared/match-events.ts";
import { 
  enforceTokenMetering, 
  burnTokensForAction, 
  calculateFinalityBurn,
  ensureSufficientTokens,
  ACTION_TOKEN_COSTS 
} from "../_shared/token-metering.ts";
import { enforceEligibility, evaluateEligibility, formatEligibilityResponse } from "../_shared/eligibility.ts";
import { deriveActorIds, getCreatedBy } from "../_shared/actor-context.ts";
import { enforceLicence } from "../_shared/licence-enforcement.ts";
// Constants for request validation
const MAX_BODY_SIZE = 1024 * 1024; // 1MB max body size
const uuidSchema = z.string().uuid();

// Valid state transitions for transaction state machine
const VALID_STATE_TRANSITIONS: Record<string, string[]> = {
  'discovery': ['intent_declared'],
  'intent_declared': ['counterparty_sighted'],
  'counterparty_sighted': ['committed'],
  'committed': ['completed'],
  'completed': [],
};

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const requestStart = Date.now();
  const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") || "*";
  const origin = req.headers.get("origin");
  const headers = corsHeaders(allowedOrigins, origin);

  const logApiRequest = async (params: {
    // Edge Functions run with untyped Supabase client generics; keep this helper permissive.
    supabase: any;
    orgId: string;
    apiKeyId: string | null;
    endpoint: string;
    method: string;
    statusCode: number;
    errorMessage?: string | null;
  }) => {
    try {
      const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null;
      const userAgent = req.headers.get("user-agent") || null;

      await params.supabase.from("api_request_logs").insert({
        org_id: params.orgId,
        api_key_id: params.apiKeyId,
        endpoint: params.endpoint,
        method: params.method,
        status_code: params.statusCode,
        response_time_ms: Math.max(0, Date.now() - requestStart),
        request_id: requestId,
        error_message: params.errorMessage || null,
        ip_address: ipAddress,
        user_agent: userAgent,
      } as any);
    } catch (e) {
      // Never fail the API call because logging failed.
      console.warn(`[${requestId}] Failed to write api_request_logs`, e);
    }
  };

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

    // Route: POST /match/:id/settle OR /match/:id/declare-intent
    // Both endpoints do the same thing: discovery → intent_declared (500 credits)
    // "settle" is kept for backward compatibility
    if (req.method === "POST" && matchId && (action === "settle" || action === "declare-intent")) {
      const endpointLabel = `/match/:id/${action}`;

      // Validate matchId is a valid UUID
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        await logApiRequest({
          supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
          endpoint: endpointLabel, method: "POST", statusCode: 400,
          errorMessage: "Invalid match ID format",
        });
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/${action} (Confirm Intent)`);

      // Enforce licence for billable action
      await enforceLicence(supabase, authCtx.orgId, endpointLabel);

      // --- Fetch match (read-only, for eligibility check & audit metadata) ---
      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      if (match.org_id !== authCtx.orgId) {
        throw new ApiException("FORBIDDEN", "You do not have permission to confirm intent for this match", 403);
      }

      const currentState = match.state || 'discovery';
      
      // Idempotent return if already confirmed
      if (currentState === 'intent_declared' || match.status === 'settled') {
        console.log(`[${requestId}] Intent already confirmed — returning idempotently`);
        await logApiRequest({
          supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
          endpoint: endpointLabel, method: "POST", statusCode: 200,
        });
        return new Response(JSON.stringify(match), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      if (currentState !== 'discovery') {
        throw new ApiException(
          "INVALID_STATE",
          `Cannot declare intent from state '${currentState}'. Must be in 'discovery' state.`,
          400
        );
      }

      // ELIGIBILITY CHECK
      try {
        enforceEligibility(match);
      } catch (eligibilityError) {
        await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "intent.denied",
          entity_type: "match",
          entity_id: matchId,
          metadata: {
            request_id: requestId,
            reason: "eligibility_check_failed",
            error: eligibilityError instanceof ApiException ? eligibilityError.message : "Unknown error",
            eligibility: formatEligibilityResponse(evaluateEligibility(match)),
          }
        });
        throw eligibilityError;
      }

      // Burn 500 tokens for intent declaration
      await burnTokensForAction(
        supabase, authCtx.orgId, actorApiKeyId,
        'declare_intent', requestId, matchId
      );

      // --- ATOMIC STATE TRANSITION (SELECT FOR UPDATE) ---
      const now = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'safe_transition_match_state',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_expected_state: 'discovery',
          p_new_state: 'intent_declared',
          p_update_fields: { status: 'settled', settled_at: now },
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);
      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const errMsg = transitionResult?.message || 'State transition failed';
        const status = errCode === 'STATE_CONFLICT' ? 409 : errCode === 'NOT_FOUND' ? 404 : 400;
        throw new ApiException(errCode, errMsg, status);
      }

      const updated = transitionResult.match;

      // Audit log — immutable proof-of-intent
      try {
        await supabase.from("audit_logs").insert({
          org_id: match.org_id,
          actor_user_id: actorUserId,
          actor_api_key_id: actorApiKeyId,
          action: "intent.confirmed",
          entity_type: "match",
          entity_id: matchId,
          metadata: {
            request_id: requestId,
            confirmed_at: now,
            hash: match.hash,
            buyer_id: match.buyer_id,
            seller_id: match.seller_id,
            commodity: match.commodity,
            quantity_amount: match.quantity_amount,
            quantity_unit: match.quantity_unit,
            price_amount: match.price_amount,
            price_currency: match.price_currency,
            tokens_burned: ACTION_TOKEN_COSTS.declare_intent,
            previous_state: currentState,
            new_state: 'intent_declared',
            note: "Intent confirmation signals interest only - no payment or legal obligation created"
          }
        });

        await recordMatchEvent(
          supabase, matchId, match.org_id, "intent.confirmed",
          {
            confirmedAt: now,
            hash: match.hash,
            commodity: match.commodity,
            tokensCharged: ACTION_TOKEN_COSTS.declare_intent,
            state: 'intent_declared',
            note: "Signals serious interest - no legal obligation"
          },
          actorUserId, actorApiKeyId
        );
      } catch (auditError) {
        console.error(`[${requestId}] Failed to create audit log:`, auditError);
        throw new ApiException("AUDIT_LOG_ERROR", "Failed to create audit trail", 500);
      }

      console.log(`[${requestId}] Intent confirmed successfully`);

      // Trigger webhooks
      triggerWebhooks(supabase, match.org_id, "intent.confirmed", {
        matchId, hash: match.hash, confirmedAt: now,
        commodity: match.commodity, quantity: match.quantity_amount,
        note: "Intent confirmation signals interest only - no payment or legal obligation"
      }).catch(err => console.error(`Webhook error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200,
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // NOTE: declare-intent is now handled by the unified settle/declare-intent block above

    // ============================================
    // Route: POST /match/:id/reveal-counterparty
    // Transitions: intent_declared → counterparty_sighted
    // Token Cost: 1,500 tokens
    // ============================================
    if (req.method === "POST" && matchId && action === "reveal-counterparty") {
      const endpointLabel = "/match/:id/reveal-counterparty";
      
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/reveal-counterparty`);

      await enforceLicence(supabase, authCtx.orgId, endpointLabel);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) throw new ApiException("NOT_FOUND", "Match not found", 404);
      if (match.org_id !== authCtx.orgId) throw new ApiException("FORBIDDEN", "You do not have permission to modify this match", 403);

      // Burn tokens BEFORE the atomic lock (token burn is itself atomic via atomic_token_burn)
      await burnTokensForAction(supabase, authCtx.orgId, actorApiKeyId, 'counterparty_sighting', requestId, matchId);

      // --- ATOMIC STATE TRANSITION (SELECT FOR UPDATE) ---
      const sightedAt = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'safe_transition_match_state',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_expected_state: 'intent_declared',
          p_new_state: 'counterparty_sighted',
          p_update_fields: {
            counterparty_sighted_at: sightedAt,
            sighting_tokens_burned: ACTION_TOKEN_COSTS.counterparty_sighting,
          },
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);
      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const status = errCode === 'STATE_CONFLICT' ? 409 : 400;
        throw new ApiException(errCode, transitionResult?.message || 'State transition failed', status);
      }

      const updated = transitionResult.match;

      await supabase.from("audit_logs").insert({
        org_id: match.org_id,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "counterparty.sighted",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          request_id: requestId,
          tokens_burned: ACTION_TOKEN_COSTS.counterparty_sighting,
          previous_state: 'intent_declared',
          new_state: 'counterparty_sighted',
          fields_revealed: ['seller_id', 'seller_name', 'buyer_id', 'buyer_name'],
        }
      });

      await recordMatchEvent(
        supabase, matchId, match.org_id, "counterparty.sighted",
        { tokensCharged: ACTION_TOKEN_COSTS.counterparty_sighting, state: 'counterparty_sighted' },
        actorUserId, actorApiKeyId
      );

      triggerWebhooks(supabase, match.org_id, "counterparty.sighted", {
        matchId, state: 'counterparty_sighted', tokensCharged: ACTION_TOKEN_COSTS.counterparty_sighting
      }).catch(err => console.error(`Webhook error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // ============================================
    // Route: POST /match/:id/commit
    // Transitions: counterparty_sighted → committed
    // Token Cost: 1,000 tokens + Finality Burn (50,000-150,000)
    // ============================================
    if (req.method === "POST" && matchId && action === "commit") {
      const endpointLabel = "/match/:id/commit";
      
      const uuidResult = uuidSchema.safeParse(matchId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid match ID format", 400);
      }

      console.log(`[${requestId}] POST /match/${matchId}/commit`);

      await enforceLicence(supabase, authCtx.orgId, endpointLabel);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) throw new ApiException("NOT_FOUND", "Match not found", 404);
      if (match.org_id !== authCtx.orgId) throw new ApiException("FORBIDDEN", "You do not have permission to modify this match", 403);

      // Calculate transaction value for finality burn
      const transactionValueUsd = (match.declared_value_usd || 
        (match.price_amount * match.quantity_amount)) || 0;
      const finalityBurn = calculateFinalityBurn(transactionValueUsd);
      const commitCost = ACTION_TOKEN_COSTS.buyer_commit;
      const totalCost = commitCost + finalityBurn;

      // Ensure sufficient tokens and burn (atomic via atomic_token_burn)
      await ensureSufficientTokens(supabase, authCtx.orgId, totalCost);
      await burnTokensForAction(supabase, authCtx.orgId, actorApiKeyId, 'buyer_commit', requestId, matchId);
      await burnTokensForAction(supabase, authCtx.orgId, actorApiKeyId, 'buyer_commit', requestId, matchId, finalityBurn, { type: 'finality_burn', transactionValue: transactionValueUsd });

      // --- ATOMIC STATE TRANSITION (SELECT FOR UPDATE) ---
      const committedAt = new Date().toISOString();
      const { data: transitionResult, error: transitionError } = await supabase.rpc(
        'safe_transition_match_state',
        {
          p_match_id: matchId,
          p_org_id: authCtx.orgId,
          p_expected_state: 'counterparty_sighted',
          p_new_state: 'committed',
          p_update_fields: {
            buyer_committed_at: committedAt,
            finality_tokens_burned: finalityBurn,
            declared_value_usd: transactionValueUsd,
          },
        }
      );

      if (transitionError) handleDatabaseError(transitionError, requestId);
      if (!transitionResult?.success) {
        const errCode = transitionResult?.error || 'TRANSITION_FAILED';
        const status = errCode === 'STATE_CONFLICT' ? 409 : 400;
        throw new ApiException(errCode, transitionResult?.message || 'State transition failed', status);
      }

      const updated = transitionResult.match;

      await supabase.from("audit_logs").insert({
        org_id: match.org_id,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "transaction.committed",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          request_id: requestId,
          commit_tokens_burned: commitCost,
          finality_tokens_burned: finalityBurn,
          total_tokens_burned: totalCost,
          transaction_value_usd: transactionValueUsd,
          previous_state: 'counterparty_sighted',
          new_state: 'committed',
        }
      });

      await recordMatchEvent(
        supabase, matchId, match.org_id, "transaction.committed",
        { commitCost, finalityBurn, totalCost, transactionValueUsd, state: 'committed' },
        actorUserId, actorApiKeyId
      );

      triggerWebhooks(supabase, match.org_id, "transaction.committed", {
        matchId, state: 'committed', commitTokens: commitCost, finalityTokens: finalityBurn, transactionValueUsd,
      }).catch(err => console.error(`Webhook error:`, err));

      await logApiRequest({
        supabase, orgId: authCtx.orgId, apiKeyId: actorApiKeyId,
        endpoint: endpointLabel, method: "POST", statusCode: 200
      });

      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }


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