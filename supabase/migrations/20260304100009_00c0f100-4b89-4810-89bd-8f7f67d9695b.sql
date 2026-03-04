-- Add attestations table with signature payload
CREATE TABLE IF NOT EXISTS public.attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  wad_id uuid NULL,
  poi_id uuid NULL,
  match_id uuid NULL REFERENCES public.matches(id),
  attester_user_id uuid NOT NULL,
  attester_role text NOT NULL,
  attester_name text NOT NULL,
  attestation_type text NOT NULL DEFAULT 'director_sign_off',
  attestation_text text NOT NULL,
  signature_payload text NOT NULL,
  signature_hash text NOT NULL,
  signed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE public.attestations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org attestations"
  ON public.attestations FOR SELECT TO authenticated
  USING (org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Users can create attestations for own org"
  ON public.attestations FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()));

-- Add completion_probability to pois if it doesn't exist (already exists per schema check)
-- Add verified_ownership_pct computed column support
-- No schema change needed - pois already has completion_probability

-- Add breach detection fields to pod_milestones
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pod_milestones' AND column_name='breach_detected_at') THEN
    ALTER TABLE public.pod_milestones ADD COLUMN breach_detected_at timestamp with time zone;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='pod_milestones' AND column_name='grace_period_ends_at') THEN
    ALTER TABLE public.pod_milestones ADD COLUMN grace_period_ends_at timestamp with time zone;
  END IF;
END $$;