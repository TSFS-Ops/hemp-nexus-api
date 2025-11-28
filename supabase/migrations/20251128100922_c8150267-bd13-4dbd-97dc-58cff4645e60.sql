-- Fix security definer view warning by recreating match_evidence view with SECURITY INVOKER
-- This ensures the view respects RLS policies of the querying user, not the view creator

DROP VIEW IF EXISTS public.match_evidence;

CREATE VIEW public.match_evidence
WITH (security_invoker = true)
AS
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

COMMENT ON VIEW public.match_evidence IS 'Evidence pack view with security_invoker=true to respect querying user RLS policies';