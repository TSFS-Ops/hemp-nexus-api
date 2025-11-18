-- Create idempotency keys table for preventing duplicate requests
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  endpoint text NOT NULL,
  request_hash text NOT NULL,
  response_data jsonb NOT NULL,
  response_status_code integer NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE(org_id, idempotency_key, endpoint)
);

-- Index for fast lookups
CREATE INDEX idx_idempotency_keys_lookup ON public.idempotency_keys(org_id, idempotency_key, endpoint);

-- Index for cleanup of expired keys
CREATE INDEX idx_idempotency_keys_expires_at ON public.idempotency_keys(expires_at);

-- Add unique constraint on match hash to prevent duplicate matches
CREATE UNIQUE INDEX idx_matches_org_hash ON public.matches(org_id, hash);

-- Enable RLS on idempotency_keys
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

-- Service role can manage all idempotency keys
CREATE POLICY "Service role can manage idempotency keys"
ON public.idempotency_keys
FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Create function to cleanup expired idempotency keys (optional, for maintenance)
CREATE OR REPLACE FUNCTION public.cleanup_expired_idempotency_keys()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.idempotency_keys
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;