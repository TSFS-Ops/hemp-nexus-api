import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, ApiException, handleDatabaseError } from "../_shared/errors.ts";
import { authenticateRequest } from "../_shared/auth.ts";
import { matchSchema, validateInput } from "../_shared/validation.ts";

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

    // Route: POST /match/:id/settle
    if (req.method === "POST" && matchId && action === "settle") {
      console.log(`[${requestId}] POST /match/${matchId}/settle`);

      const { data: match, error: fetchError } = await supabase
        .from("matches")
        .select("*")
        .eq("id", matchId)
        .maybeSingle();

      if (fetchError) handleDatabaseError(fetchError, requestId);
      if (!match) {
        throw new ApiException("NOT_FOUND", "Match not found", 404);
      }

      // If already settled, return as-is (idempotent)
      if (match.status === "settled") {
        console.log(`[${requestId}] Match already settled`);
        return new Response(JSON.stringify(match), {
          status: 200,
          headers: { ...headers, "Content-Type": "application/json" },
        });
      }

      // Update to settled
      const { data: updated, error: updateError } = await supabase
        .from("matches")
        .update({ status: "settled", settled_at: new Date().toISOString() })
        .eq("id", matchId)
        .select()
        .single();

      if (updateError) handleDatabaseError(updateError, requestId);

      // Create audit log for settlement
      await supabase.from("audit_logs").insert({
        org_id: match.org_id,
        actor_user_id: authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "match.settled",
        entity_type: "match",
        entity_id: matchId,
        metadata: {
          settled_at: updated.settled_at,
          hash: match.hash
        }
      });

      console.log(`[${requestId}] Match settled successfully`);
      return new Response(JSON.stringify(updated), {
        status: 200,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    // Route: GET /match/:id
    if (req.method === "GET" && matchId && !action) {
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
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (status && (status === "matched" || status === "settled")) {
        query = query.eq("status", status);
      }

      if (commodity) {
        query = query.ilike("commodity", `%${commodity}%`);
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

      // Insert match
      const { data: match, error: insertError } = await supabase
        .from("matches")
        .insert({
          org_id: authCtx.orgId,
          created_by: authCtx.userId || null,
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

      // Create audit log for match creation
      await supabase.from("audit_logs").insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId,
        actor_api_key_id: authCtx.isApiKey ? authCtx.userId : null,
        action: "match.created",
        entity_type: "match",
        entity_id: match.id,
        metadata: {
          commodity: body.commodity,
          buyer_id: body.buyer.id,
          seller_id: body.seller.id,
          quantity: body.quantity,
          price: body.price,
          hash
        }
      });

      console.log(`[${requestId}] Match created: ${match.id}`);
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