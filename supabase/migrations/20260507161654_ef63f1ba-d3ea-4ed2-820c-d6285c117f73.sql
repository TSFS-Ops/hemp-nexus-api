CREATE TABLE IF NOT EXISTS public.staging_password_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  user_id uuid NOT NULL,
  password_plaintext text,
  reveal_token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staging_password_tokens_expires_idx
  ON public.staging_password_tokens (expires_at);

ALTER TABLE public.staging_password_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.staging_password_tokens FROM anon, authenticated, PUBLIC;
