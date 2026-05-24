-- 1. webhook_endpoints
REVOKE SELECT (secret_hash, previous_secret_hash)
  ON public.webhook_endpoints
  FROM anon, authenticated, PUBLIC;

GRANT SELECT (
  id, org_id, url, events, status, last_delivery_at,
  created_at, updated_at, consecutive_failures, disabled_at,
  is_primary, previous_secret_expires_at
) ON public.webhook_endpoints TO authenticated;

DROP POLICY IF EXISTS "Admins can select webhook_endpoints" ON public.webhook_endpoints;
CREATE POLICY "Admins can select webhook_endpoints"
  ON public.webhook_endpoints
  FOR SELECT
  TO authenticated
  USING (is_admin(auth.uid()));

-- 2. staging_password_tokens
CREATE OR REPLACE FUNCTION public.guard_staging_password_tokens_production()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.password_plaintext IS NOT NULL AND public.is_production_environment() THEN
    RAISE EXCEPTION 'staging_password_tokens.password_plaintext is forbidden in production'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_staging_password_tokens_production_trg
  ON public.staging_password_tokens;
CREATE TRIGGER guard_staging_password_tokens_production_trg
  BEFORE INSERT OR UPDATE ON public.staging_password_tokens
  FOR EACH ROW EXECUTE FUNCTION public.guard_staging_password_tokens_production();

DROP POLICY IF EXISTS "Deny all client access to staging_password_tokens"
  ON public.staging_password_tokens;
CREATE POLICY "Deny all client access to staging_password_tokens"
  ON public.staging_password_tokens
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- 3. evidence-waiver-packets bucket
DROP POLICY IF EXISTS "Deny anon/auth on evidence-waiver-packets"
  ON storage.objects;
CREATE POLICY "Deny anon/auth on evidence-waiver-packets"
  ON storage.objects
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'evidence-waiver-packets')
  WITH CHECK (bucket_id <> 'evidence-waiver-packets');
