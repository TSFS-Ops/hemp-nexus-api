-- Batch D — Governance waiver/bypass lifecycle.
-- Tracks HQ-granted waivers/bypasses with 1-use / 7-day default cap.

CREATE TABLE IF NOT EXISTS public.governance_waivers (
  waiver_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL,
  posture       text NOT NULL,                         -- 'waiver' | 'bypass'
  scope         text NOT NULL,                         -- e.g. 'poi','wad','execution','finality','custom'
  scope_id      uuid NULL,
  match_id      uuid NULL,
  poi_id        uuid NULL,
  wad_id        uuid NULL,
  granted_by    uuid NOT NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  max_uses      int  NOT NULL DEFAULT 1,
  uses          int  NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'active',
  reason_code   text NOT NULL,
  note          text NULL,
  renewed_from  uuid NULL REFERENCES public.governance_waivers(waiver_id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT governance_waivers_posture_chk
    CHECK (posture IN ('waiver','bypass')),
  CONSTRAINT governance_waivers_status_chk
    CHECK (status IN ('active','consumed','expired','revoked')),
  CONSTRAINT governance_waivers_max_uses_chk
    CHECK (max_uses >= 1),
  CONSTRAINT governance_waivers_uses_chk
    CHECK (uses >= 0),
  CONSTRAINT governance_waivers_expiry_window_chk
    CHECK (expires_at > granted_at AND expires_at <= granted_at + interval '7 days')
);

CREATE INDEX IF NOT EXISTS governance_waivers_org_idx        ON public.governance_waivers(org_id);
CREATE INDEX IF NOT EXISTS governance_waivers_match_idx      ON public.governance_waivers(match_id) WHERE match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS governance_waivers_poi_idx        ON public.governance_waivers(poi_id)   WHERE poi_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS governance_waivers_wad_idx        ON public.governance_waivers(wad_id)   WHERE wad_id   IS NOT NULL;
CREATE INDEX IF NOT EXISTS governance_waivers_scope_idx      ON public.governance_waivers(scope, scope_id);
CREATE INDEX IF NOT EXISTS governance_waivers_status_exp_idx ON public.governance_waivers(status, expires_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_governance_waivers_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_governance_waivers_updated_at ON public.governance_waivers;
CREATE TRIGGER trg_governance_waivers_updated_at
BEFORE UPDATE ON public.governance_waivers
FOR EACH ROW EXECUTE FUNCTION public.set_governance_waivers_updated_at();

-- RLS: platform_admin read; service_role writes; no other access.
ALTER TABLE public.governance_waivers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "governance_waivers platform_admin read" ON public.governance_waivers;
CREATE POLICY "governance_waivers platform_admin read"
ON public.governance_waivers
FOR SELECT
TO authenticated
USING (public.is_admin(auth.uid()));

-- No INSERT/UPDATE/DELETE policies for authenticated users → only service_role
-- (which bypasses RLS) can mutate. This matches the binding decision:
-- "no ordinary org user write access; service_role writes".

COMMENT ON TABLE public.governance_waivers IS
  'Batch D — HQ-granted waivers/bypasses. 1 use / 7 days max. Renewal creates a new row referencing renewed_from. Writes via service_role only.';