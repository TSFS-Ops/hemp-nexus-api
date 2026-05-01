-- Temporary, locked-down diagnostic to fingerprint the Vault INTERNAL_CRON_KEY.
-- Returns only safe fields. Raw secret never exposed.
CREATE OR REPLACE FUNCTION public._diag_vault_cron_key_fingerprint()
RETURNS TABLE(exists_in_vault boolean, secret_length int, sha256_prefix text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'INTERNAL_CRON_KEY'
  LIMIT 1;

  IF v_secret IS NULL THEN
    RETURN QUERY SELECT false, 0, ''::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    length(v_secret),
    substr(encode(digest(v_secret, 'sha256'), 'hex'), 1, 8);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._diag_vault_cron_key_fingerprint() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._diag_vault_cron_key_fingerprint() TO postgres, service_role;