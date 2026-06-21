CREATE TABLE public.registry_counterparty_link_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  registry_company_record_id uuid NOT NULL REFERENCES public.registry_company_records(id) ON DELETE RESTRICT,
  counterparty_id uuid REFERENCES public.counterparties(id) ON DELETE SET NULL,
  counterparty_name text NOT NULL,
  score numeric(5,2) NOT NULL DEFAULT 0,
  score_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposed_by_user_id uuid NOT NULL,
  claim_id uuid REFERENCES public.registry_company_claims(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed',
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registry_counterparty_link_proposals_score_range CHECK (score >= 0 AND score <= 100),
  CONSTRAINT registry_counterparty_link_proposals_status_check CHECK (status IN ('proposed','under_review','approved','rejected','withdrawn')),
  CONSTRAINT registry_counterparty_link_proposals_idempotency_unique UNIQUE (proposed_by_user_id, idempotency_key)
);

GRANT SELECT ON public.registry_counterparty_link_proposals TO authenticated;
GRANT ALL ON public.registry_counterparty_link_proposals TO service_role;

CREATE INDEX registry_counterparty_link_proposals_org_created_idx ON public.registry_counterparty_link_proposals (org_id, created_at DESC);
CREATE INDEX registry_counterparty_link_proposals_counterparty_idx ON public.registry_counterparty_link_proposals (counterparty_id, created_at DESC);
CREATE INDEX registry_counterparty_link_proposals_registry_idx ON public.registry_counterparty_link_proposals (registry_company_record_id, created_at DESC);

ALTER TABLE public.registry_counterparty_link_proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org link proposals"
ON public.registry_counterparty_link_proposals
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
);

CREATE POLICY "Registry admins can manage link proposals"
ON public.registry_counterparty_link_proposals
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'compliance_owner'::public.app_role)
);

CREATE OR REPLACE FUNCTION public.set_registry_counterparty_link_proposals_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_registry_counterparty_link_proposals_updated_at
BEFORE UPDATE ON public.registry_counterparty_link_proposals
FOR EACH ROW
EXECUTE FUNCTION public.set_registry_counterparty_link_proposals_updated_at();