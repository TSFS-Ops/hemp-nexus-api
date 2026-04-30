-- Drop legacy 3-arg atomic_generate_poi (v1).
-- Replaced by atomic_generate_poi_v2 which enforces mandatory acknowledgements
-- (declaration_ack, atb_ack) and per-side document gates. The v1 path bypassed
-- those checks and is no longer referenced by any edge function or client code.
DROP FUNCTION IF EXISTS public.atomic_generate_poi(uuid, uuid, timestamptz);