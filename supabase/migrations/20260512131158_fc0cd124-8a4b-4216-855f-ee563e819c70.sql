ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_organizations_is_demo
  ON public.organizations (is_demo)
  WHERE is_demo = true;

COMMENT ON COLUMN public.organizations.is_demo IS
  'Phase 1 demo isolation: when true, the organisation is a fixture/demo org. All token burns short-circuit (no ledger row, no balance change, no billing artefact). Set only via migration or admin tooling.';