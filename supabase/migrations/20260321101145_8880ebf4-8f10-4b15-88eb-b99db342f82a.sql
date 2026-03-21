
-- Persistent ECDSA signing key registry for collapse engine
CREATE TABLE public.signing_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  algorithm text NOT NULL DEFAULT 'ECDSA-P256',
  public_key_jwk jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'rotated')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid,
  revoked_reason text,
  rotated_to uuid REFERENCES public.signing_keys(id),
  UNIQUE (org_id, key_id)
);

-- RLS
ALTER TABLE public.signing_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Orgs can view own signing keys"
  ON public.signing_keys FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- Index for collapse lookups
CREATE INDEX idx_signing_keys_org_key ON public.signing_keys (org_id, key_id, status);

-- Prevent deletion of signing keys (audit trail preservation)
CREATE OR REPLACE FUNCTION public.prevent_signing_key_deletion()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION 'Signing keys cannot be deleted. Revoke them instead.';
END;
$$;

CREATE TRIGGER trg_prevent_signing_key_delete
  BEFORE DELETE ON public.signing_keys
  FOR EACH ROW EXECUTE FUNCTION public.prevent_signing_key_deletion();
