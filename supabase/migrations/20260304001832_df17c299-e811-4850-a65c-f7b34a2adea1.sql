
-- UBO ownership links table for WaD hard-gate #3
CREATE TABLE public.ubo_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id),
  company_entity_id UUID NOT NULL REFERENCES public.entities(id),
  person_entity_id UUID NOT NULL REFERENCES public.entities(id),
  ownership_percentage NUMERIC(5,2) NOT NULL CHECK (ownership_percentage > 0 AND ownership_percentage <= 100),
  verified_at TIMESTAMPTZ,
  verified_by UUID,
  verification_method TEXT DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired', 'rejected')),
  document_id UUID,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(company_entity_id, person_entity_id)
);

-- RLS
ALTER TABLE public.ubo_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on ubo_links"
  ON public.ubo_links FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users read own org ubo_links"
  ON public.ubo_links FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()));

-- Updated_at trigger
CREATE TRIGGER update_ubo_links_updated_at
  BEFORE UPDATE ON public.ubo_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Index for WaD gate lookups
CREATE INDEX idx_ubo_links_company ON public.ubo_links(company_entity_id, status);
