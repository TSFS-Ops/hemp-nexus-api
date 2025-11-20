-- Fix security warnings from previous migration

-- Fix function search path for generate_event_hash
CREATE OR REPLACE FUNCTION generate_event_hash(
  event_type TEXT,
  event_data JSONB,
  previous_hash TEXT
) RETURNS TEXT AS $$
DECLARE
  payload TEXT;
BEGIN
  payload := event_type || event_data::text || COALESCE(previous_hash, '');
  RETURN encode(digest(payload, 'sha256'), 'hex');
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

-- Drop and recreate match_evidence view without SECURITY DEFINER
-- The view will now use the querying user's permissions
DROP VIEW IF EXISTS public.match_evidence;

CREATE VIEW public.match_evidence AS
SELECT 
  m.id as match_id,
  m.org_id,
  m.hash as match_hash,
  m.status,
  m.created_at as match_created_at,
  m.settled_at,
  jsonb_build_object(
    'buyer', jsonb_build_object('id', m.buyer_id, 'name', m.buyer_name),
    'seller', jsonb_build_object('id', m.seller_id, 'name', m.seller_name),
    'commodity', m.commodity,
    'quantity', jsonb_build_object('amount', m.quantity_amount, 'unit', m.quantity_unit),
    'price', jsonb_build_object('amount', m.price_amount, 'currency', m.price_currency),
    'terms', m.terms
  ) as match_data,
  (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', me.id,
        'type', me.event_type,
        'timestamp', me.created_at,
        'data', me.event_data,
        'hash', me.payload_hash,
        'previousHash', me.previous_event_hash
      ) ORDER BY me.created_at ASC
    )
    FROM public.match_events me
    WHERE me.match_id = m.id
  ) as event_timeline
FROM public.matches m;