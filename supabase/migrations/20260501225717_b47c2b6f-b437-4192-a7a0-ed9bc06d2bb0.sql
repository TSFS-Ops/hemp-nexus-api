-- Service-role-only helpers for one-shot INTERNAL_CRON_KEY vault sync.
-- Locked to service_role; safe to drop after rotation.

CREATE OR REPLACE FUNCTION public.vault_upsert_internal_cron_key(p_value text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM vault.secrets WHERE name = 'INTERNAL_CRON_KEY';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(
      p_value,
      'INTERNAL_CRON_KEY',
      'Shared internal cron key for pg_cron -> guarded edge functions'
    );
  ELSE
    PERFORM vault.update_secret(v_id, p_value, 'INTERNAL_CRON_KEY',
      'Shared internal cron key for pg_cron -> guarded edge functions');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.vault_read_internal_cron_key_fingerprint()
RETURNS TABLE(len int, sha8 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT length(decrypted_secret)::int AS len,
         substr(encode(extensions.digest(decrypted_secret, 'sha256'), 'hex'), 1, 8) AS sha8
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_CRON_KEY';
END;
$$;

REVOKE ALL ON FUNCTION public.vault_upsert_internal_cron_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vault_read_internal_cron_key_fingerprint() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vault_upsert_internal_cron_key(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.vault_read_internal_cron_key_fingerprint() TO service_role;