import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest, requireScope } from "../_shared/auth.ts";
import { searchDataSources } from "../_shared/data-sources.ts";
import { recordSelection } from "../_shared/performance.ts";
import { signalSchema, signalSelectSchema, validateInput } from "../_shared/validation.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { triggerWebhooks } from "../_shared/webhooks.ts";
import { enforceTokenMetering } from "../_shared/token-metering.ts";
import { deriveActorIds, getCreatedBy } from "../_shared/actor-context.ts";
import { assertIdempotencyKey } from "../_shared/idempotency.ts";

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

    // Normalize path: strip optional prefixes and the function name
    const parts = [...rawParts];
    if (parts[0] === "functions") parts.shift();
    if (parts[0] === "v1") parts.shift();
    if (parts[0] === "signals") parts.shift();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    requireScope(authCtx, 'signals');

    // Derive actor IDs once for use throughout the request
    const { actorUserId, actorApiKeyId } = deriveActorIds(authCtx);

    // Rate limiting
    await checkRateLimit(supabase, authCtx.orgId, actorApiKeyId, 'signals', 'signals:write');

    // Enforce token metering - burns 1 token per request
    await enforceTokenMetering(
      supabase,
      authCtx.orgId,
      actorApiKeyId,
      "/signals",
      requestId
    );

    // POST / - Create new signal and trigger search
    if (req.method === "POST" && parts.length === 0) {
      assertIdempotencyKey(req);
      // Check body size to prevent DoS attacks
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        throw new ApiException("PAYLOAD_TOO_LARGE", "Request body exceeds maximum size of 1MB", 413);
      }

      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(signalSchema, rawBody);
      } catch (error) {
        throw new ApiException("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid input", 400);
      }

      const { product, quantity, unit, location, deliveryWindow, budget, currency, notes } = validatedData;

      // Build content object from new schema
      const content = {
        product,
        quantity,
        unit,
        location,
        deliveryWindow,
        budget,
        currency,
        notes,
      };

      const { data: signal, error } = await supabase
        .from("signals")
        .insert({
          org_id: authCtx.orgId,
          type: "buyer", // Default to buyer
          content,
          expires_at: deliveryWindow?.end || null,
          created_by: getCreatedBy(authCtx),
        })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);
      
      // Trigger background data source search (fire and forget)
      searchDataSources(signal.id, authCtx.orgId, supabase).catch((err) => 
        console.error(`[${signal.id}] Background search error:`, err)
      );

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "signal.created",
        entity_type: "signal",
        entity_id: signal.id,
        metadata: { product, quantity, unit },
      });

      // Trigger webhooks in background (fire and forget)
      triggerWebhooks(supabase, authCtx.orgId, "signal.created", {
        signalId: signal.id,
        product,
        quantity,
        unit,
        status: signal.status,
      }, { eventIdempotencyKey: `signal.created:${signal.id}` }).catch(err => console.error(`Webhook trigger error:`, err));

      return new Response(
        JSON.stringify({
          signalId: signal.id,
          options: []
        }),
        { status: 201, headers: { "Content-Type": "application/json", ...headers } },
      );
    }

    // GET / - List signals
    if (req.method === "GET" && parts.length === 0) {
      const limit = parseInt(url.searchParams.get("limit") || "50");
      const status = url.searchParams.get("status");

      let query = supabase
        .from("signals")
        .select("*")
        .eq("org_id", authCtx.orgId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (status) {
        query = query.eq("status", status);
      }

      const { data, error } = await query;
      if (error) handleDatabaseError(error, requestId);

      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // GET /:id/status - Get signal status and progress
    if (req.method === "GET" && parts.length === 2 && parts[1] === "status") {
      const signalId = parts[0];
      
      // Validate signalId is a valid UUID
      const uuidResult = uuidSchema.safeParse(signalId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid signal ID format", 400);
      }

      const { data: signal, error: signalError } = await supabase
        .from("signals")
        .select("id, status, type, created_at, expires_at, updated_at")
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (signalError) throw signalError;

      const { count: optionsCount } = await supabase
        .from("options")
        .select("*", { count: "exact", head: true })
        .eq("signal_id", signalId);

      const isSearchComplete = signal.status !== "active";

      return new Response(
        JSON.stringify({
          signalId: signal.id,
          status: signal.status,
          type: signal.type,
          createdAt: signal.created_at,
          expiresAt: signal.expires_at,
          updatedAt: signal.updated_at,
          optionsCount: optionsCount || 0,
          searchComplete: isSearchComplete,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...headers },
        }
      );
    }

    // GET /:id - Get signal with options
    if (req.method === "GET" && parts.length === 1) {
      const signalId = parts[0];
      
      // Validate signalId is a valid UUID
      const uuidResult = uuidSchema.safeParse(signalId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid signal ID format", 400);
      }

      const { data: signal, error: signalError } = await supabase
        .from("signals")
        .select("*")
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (signalError) throw signalError;

      const { data: options, error: optionsError } = await supabase
        .from("options")
        .select("*, data_source:data_sources(name, type)")
        .eq("signal_id", signalId)
        .order("score", { ascending: false });

      if (optionsError) throw optionsError;

      return new Response(JSON.stringify({ signal, options }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...headers },
      });
    }

    // POST /:id/select - Select an option and hand off
    if (req.method === "POST" && parts.length === 2 && parts[1] === "select") {
      assertIdempotencyKey(req);
      const signalId = parts[0];
      
      // Validate signalId is a valid UUID
      const uuidResult = uuidSchema.safeParse(signalId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid signal ID format", 400);
      }

      // Check body size
      const contentLength = req.headers.get("content-length");
      if (contentLength && parseInt(contentLength) > MAX_BODY_SIZE) {
        throw new ApiException("PAYLOAD_TOO_LARGE", "Request body exceeds maximum size of 1MB", 413);
      }

      const rawBody = await req.json();
      
      let validatedData;
      try {
        validatedData = validateInput(signalSelectSchema, rawBody);
      } catch (error) {
        throw new ApiException("VALIDATION_ERROR", error instanceof Error ? error.message : "Invalid input", 400);
      }

      const { option_id } = validatedData;

      // Verify signal belongs to org
      const { data: signal } = await supabase
        .from("signals")
        .select("*")
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId)
        .single();

      if (!signal) {
        throw new ApiException("NOT_FOUND", "Signal not found", 404);
      }

      // Get option and data source
      const { data: option } = await supabase
        .from("options")
        .select("*, data_source:data_sources(*)")
        .eq("id", option_id)
        .eq("signal_id", signalId)
        .single();

      if (!option) {
        throw new ApiException("NOT_FOUND", "Option not found", 404);
      }

      // Generate short-lived handoff token
      const handoffToken = crypto.randomUUID();

      const { data: selection, error } = await supabase
        .from("selections")
        .insert({
          signal_id: signalId,
          option_id,
          selected_by: actorUserId,
          handoff_token: handoffToken,
          handoff_data: {
            data_source_id: option.data_source.id,
            data_source_type: option.data_source.type,
            source_link: option.source_link,
          },
        })
        .select()
        .single();

      if (error) handleDatabaseError(error, requestId);

      // Update signal status
      await supabase.from("signals").update({ status: "matched" }).eq("id", signalId);

      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: actorUserId,
        actor_api_key_id: actorApiKeyId,
        action: "signal.option_selected",
        entity_type: "selection",
        entity_id: selection.id,
        metadata: { signal_id: signalId, option_id },
      });

      // Record selection for performance tracking
      await recordSelection(supabase, signalId, option_id);

      // Trigger webhooks in background
      triggerWebhooks(supabase, authCtx.orgId, "option.selected", {
        signalId,
        optionId: option_id,
        selectionId: selection.id,
        dataSourceType: option.data_source.type,
        sourceLink: option.source_link,
      }, { eventIdempotencyKey: `option.selected:${selection.id}` }).catch(err => console.error(`Webhook trigger error:`, err));

      return new Response(
        JSON.stringify({
          selection_id: selection.id,
          handoff_token: handoffToken,
          handoff_url: option.source_link,
          message: "Option selected. Handoff to source system.",
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...headers } },
      );
    }

    // DELETE /:id - Cancel signal
    if (req.method === "DELETE" && parts.length === 1) {
      const signalId = parts[0];
      
      // Validate signalId is a valid UUID
      const uuidResult = uuidSchema.safeParse(signalId);
      if (!uuidResult.success) {
        throw new ApiException("VALIDATION_ERROR", "Invalid signal ID format", 400);
      }

      const { error } = await supabase
        .from("signals")
        .update({ status: "expired" })
        .eq("id", signalId)
        .eq("org_id", authCtx.orgId);

      if (error) handleDatabaseError(error, requestId);

      return new Response(null, { status: 204, headers });
    }

    throw new ApiException("NOT_FOUND", "Endpoint not found", 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});

