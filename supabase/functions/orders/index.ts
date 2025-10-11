import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import { corsHeaders, handleCors } from '../_shared/cors.ts';
import { errorResponse, ApiException } from '../_shared/errors.ts';
import { authenticateRequest } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  const allowedOrigins = Deno.env.get('ALLOWED_ORIGINS') || '*';
  const headers = corsHeaders(allowedOrigins);

  try {
    const corsResponse = handleCors(req, allowedOrigins);
    if (corsResponse) return corsResponse;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authCtx = await authenticateRequest(req, supabaseUrl, supabaseKey);
    const url = new URL(req.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // GET /orders - List orders
    if (req.method === 'GET' && pathParts.length === 1) {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const status = url.searchParams.get('status');

      let query = supabase
        .from('orders')
        .select('*, listing:listings(*), buyer_org:organizations!buyer_org_id(*), seller_org:organizations!seller_org_id(*)')
        .or(`buyer_org_id.eq.${authCtx.orgId},seller_org_id.eq.${authCtx.orgId}`)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;
      if (error) throw error;

      return new Response(
        JSON.stringify({ data }),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // POST /orders - Create order (idempotent)
    if (req.method === 'POST' && pathParts.length === 1) {
      const idempotencyKey = req.headers.get('idempotency-key');
      const { listing_id, seller_org_id, quantity } = await req.json();

      if (!listing_id || !seller_org_id || !quantity) {
        throw new ApiException('VALIDATION_ERROR', 'Missing required fields', 400);
      }

      // Check for existing order with idempotency key
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from('orders')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify(existing),
            { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
          );
        }
      }

      // Get listing details
      const { data: listing, error: listingError } = await supabase
        .from('listings')
        .select('*')
        .eq('id', listing_id)
        .single();

      if (listingError || !listing) {
        throw new ApiException('NOT_FOUND', 'Listing not found', 404);
      }

      if (listing.status !== 'active') {
        throw new ApiException('VALIDATION_ERROR', 'Listing is not active', 400);
      }

      // Create order
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .insert({
          buyer_org_id: authCtx.orgId,
          seller_org_id,
          listing_id,
          quantity,
          price: listing.price,
          currency: listing.currency,
          status: 'draft',
          idempotency_key: idempotencyKey,
        })
        .select()
        .single();

      if (orderError) throw orderError;

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: 'order.created',
        entity_type: 'order',
        entity_id: order.id,
        metadata: { listing_id, quantity },
      });

      return new Response(
        JSON.stringify(order),
        { status: 201, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    // PATCH /orders/:id - Update order
    if (req.method === 'PATCH' && pathParts.length === 2) {
      const orderId = pathParts[1];
      const updates = await req.json();

      // Verify order belongs to user's org
      const { data: existing } = await supabase
        .from('orders')
        .select('buyer_org_id, seller_org_id')
        .eq('id', orderId)
        .single();

      if (!existing || (existing.buyer_org_id !== authCtx.orgId && existing.seller_org_id !== authCtx.orgId)) {
        throw new ApiException('FORBIDDEN', 'Cannot update this order', 403);
      }

      const { data, error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId)
        .select()
        .single();

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        org_id: authCtx.orgId,
        actor_user_id: authCtx.userId || null,
        action: 'order.updated',
        entity_type: 'order',
        entity_id: orderId,
        metadata: updates,
      });

      return new Response(
        JSON.stringify(data),
        { status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
      );
    }

    throw new ApiException('NOT_FOUND', 'Endpoint not found', 404);
  } catch (error) {
    return errorResponse(error as Error, requestId, headers);
  }
});
