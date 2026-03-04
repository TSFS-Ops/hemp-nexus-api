
-- V3 Sprint 1: Entities + Interests + Mutual Interests

CREATE TABLE IF NOT EXISTS public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_type text NOT NULL CHECK (entity_type IN ('INDIVIDUAL', 'COMPANY')),
  legal_name text NOT NULL,
  jurisdiction_code text NOT NULL,
  registration_number text,
  tax_number text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_entities_org ON public.entities(org_id);

CREATE TABLE IF NOT EXISTS public.interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  from_entity_id uuid NOT NULL REFERENCES public.entities(id),
  to_entity_id uuid NOT NULL REFERENCES public.entities(id),
  context text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, from_entity_id, to_entity_id)
);

CREATE TABLE IF NOT EXISTS public.mutual_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_a uuid NOT NULL REFERENCES public.entities(id),
  entity_b uuid NOT NULL REFERENCES public.entities(id),
  formed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED')),
  UNIQUE (org_id, entity_a, entity_b)
);

CREATE TABLE IF NOT EXISTS public.ownership_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  company_entity_id uuid NOT NULL REFERENCES public.entities(id),
  owner_entity_id uuid NOT NULL REFERENCES public.entities(id),
  ownership_percent numeric(5,2) NOT NULL CHECK (ownership_percent > 0 AND ownership_percent <= 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ownership_company ON public.ownership_links(org_id, company_entity_id);

CREATE TABLE IF NOT EXISTS public.authority_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  company_entity_id uuid NOT NULL REFERENCES public.entities(id),
  person_entity_id uuid NOT NULL REFERENCES public.entities(id),
  method text NOT NULL CHECK (method IN ('REGISTRY_DIRECTOR', 'BOARD_RESOLUTION', 'POWER_OF_ATTORNEY')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'EXPIRED', 'FAILED')),
  verified_by uuid,
  verified_at timestamptz,
  expires_at timestamptz,
  document_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_authority_company ON public.authority_records(org_id, company_entity_id);

-- RLS
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mutual_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authority_records ENABLE ROW LEVEL SECURITY;

-- Entities RLS
CREATE POLICY "Service role manages entities" ON public.entities FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org entities" ON public.entities FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all entities" ON public.entities FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Interests RLS
CREATE POLICY "Service role manages interests" ON public.interests FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org interests" ON public.interests FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Mutual interests RLS
CREATE POLICY "Service role manages mutual_interests" ON public.mutual_interests FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org mutual_interests" ON public.mutual_interests FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Ownership links RLS
CREATE POLICY "Service role manages ownership_links" ON public.ownership_links FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org ownership_links" ON public.ownership_links FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all ownership_links" ON public.ownership_links FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Authority records RLS
CREATE POLICY "Service role manages authority_records" ON public.authority_records FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org authority_records" ON public.authority_records FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
