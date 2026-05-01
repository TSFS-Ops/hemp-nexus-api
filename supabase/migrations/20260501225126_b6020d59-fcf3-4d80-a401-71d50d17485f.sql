-- Re-create diagnostic so it queries vault as the function owner (postgres),
-- and explicitly grant SELECT on vault.decrypted_secrets to function-owner only.
CREATE OR REPLACE FUNCTION public._diag_vault_cron_key_fingerprint()
RETURNS TABLE(exists_in_vault boolean, secret_length int, sha256_prefix text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
    INTO v_secret USING 'INTERNAL_CRON_KEY';

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

GRANT EXECUTE ON FUNCTION public._diag_vault_cron_key_fingerprint() TO authenticated, anon, service_role, postgres;

-- Snapshot table (one-shot)
CREATE TABLE IF NOT EXISTS public._diag_secret_fingerprints (
  id serial PRIMARY KEY,
  source text NOT NULL,
  exists_flag boolean NOT NULL,
  secret_length int NOT NULL,
  sha256_prefix text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._diag_secret_fingerprints ENABLE ROW LEVEL SECURITY;

INSERT INTO public._diag_secret_fingerprints (source, exists_flag, secret_length, sha256_prefix)
SELECT 'vault', exists_in_vault, secret_length, sha256_prefix
FROM public._diag_vault_cron_key_fingerprint();