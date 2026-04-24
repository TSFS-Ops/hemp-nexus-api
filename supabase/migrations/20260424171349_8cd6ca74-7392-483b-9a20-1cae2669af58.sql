-- ============================================================
-- Step 2: per-tenant gate-position configurability
-- ============================================================

-- Enum for the three David/Daniel gate positions
DO $$ BEGIN
  CREATE TYPE public.gate_position AS ENUM ('entry', 'poi_mint', 'wad_only');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Per-org governance profile. One active row per org at a time
-- (enforced by the partial unique index below). Historical rows are
-- retained so we can reconstruct the posture in force at any past moment.
CREATE TABLE IF NOT EXISTS public.org_governance_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id UUID NOT NULL,
  verification_gate_position public.gate_position NOT NULL DEFAULT 'poi_mint',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to TIMESTAMPTZ,
  created_by UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One active (effective_to IS NULL) row per org
CREATE UNIQUE INDEX IF NOT EXISTS org_governance_profiles_active_uniq
  ON public.org_governance_profiles (org_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS org_governance_profiles_org_idx
  ON public.org_governance_profiles (org_id);

CREATE INDEX IF NOT EXISTS org_governance_profiles_history_idx
  ON public.org_governance_profiles (org_id, effective_from DESC);

-- updated_at trigger
DROP TRIGGER IF EXISTS update_org_governance_profiles_updated_at
  ON public.org_governance_profiles;
CREATE TRIGGER update_org_governance_profiles_updated_at
  BEFORE UPDATE ON public.org_governance_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE public.org_governance_profiles ENABLE ROW LEVEL SECURITY;

-- Org members can read their own org's posture
DROP POLICY IF EXISTS "Org members can read their org's governance profile"
  ON public.org_governance_profiles;
CREATE POLICY "Org members can read their org's governance profile"
ON public.org_governance_profiles
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);

-- Only platform admins can mutate (insert/update). No deletes — history is sacred.
DROP POLICY IF EXISTS "Platform admins can insert governance profiles"
  ON public.org_governance_profiles;
CREATE POLICY "Platform admins can insert governance profiles"
ON public.org_governance_profiles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

DROP POLICY IF EXISTS "Platform admins can update governance profiles"
  ON public.org_governance_profiles;
CREATE POLICY "Platform admins can update governance profiles"
ON public.org_governance_profiles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'))
WITH CHECK (public.has_role(auth.uid(), 'platform_admin'));

-- ── Helper function: read the active gate position with a safe default ──
-- Edge functions call this with the service role; defaults to 'poi_mint'
-- if no profile row exists, which preserves the Step 1 behaviour for
-- every existing org (none of whom have a profile yet).
CREATE OR REPLACE FUNCTION public.get_org_gate_position(_org_id UUID)
RETURNS public.gate_position
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT verification_gate_position
      FROM public.org_governance_profiles
      WHERE org_id = _org_id
        AND effective_to IS NULL
      ORDER BY effective_from DESC
      LIMIT 1
    ),
    'poi_mint'::public.gate_position
  );
$$;

COMMENT ON TABLE public.org_governance_profiles IS
  'Per-org legitimacy gate posture. One active row per org. Historical rows retained for forensic audit memory (Step 3).';
COMMENT ON COLUMN public.org_governance_profiles.verification_gate_position IS
  'entry = require KYB before any platform action; poi_mint = require before issuing POI / outreach (default); wad_only = defer entirely until WaD 9-gate check.';
COMMENT ON FUNCTION public.get_org_gate_position(UUID) IS
  'Returns the currently-active gate position for an org. Defaults to poi_mint if no profile row exists.';