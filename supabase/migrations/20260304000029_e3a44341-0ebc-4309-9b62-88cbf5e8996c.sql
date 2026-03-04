
-- V3 Sprint 1: POIs, WaDs, PoDs, Breaches, Compliance Cases

CREATE TABLE IF NOT EXISTS public.pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  buyer_entity_id uuid NOT NULL REFERENCES public.entities(id),
  seller_entity_id uuid NOT NULL REFERENCES public.entities(id),
  industry_code text NOT NULL,
  jurisdiction_code text NOT NULL,
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'DRAFT' CHECK (state IN ('DRAFT', 'ISSUED', 'EXPIRED', 'SUPERSEDED')),
  completion_probability numeric(5,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pois_pair ON public.pois(org_id, buyer_entity_id, seller_entity_id);
CREATE INDEX IF NOT EXISTS idx_pois_state ON public.pois(org_id, state);

CREATE TABLE IF NOT EXISTS public.p3_wads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  poi_id uuid NOT NULL REFERENCES public.pois(id),
  state text NOT NULL DEFAULT 'REQUESTED' CHECK (state IN ('REQUESTED', 'DENIED', 'ISSUED')),
  denial_reasons jsonb,
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_p3_wads_poi ON public.p3_wads(org_id, poi_id);

CREATE TABLE IF NOT EXISTS public.pods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  wad_id uuid NOT NULL REFERENCES public.p3_wads(id),
  state text NOT NULL DEFAULT 'CREATED' CHECK (state IN ('CREATED', 'IN_PROGRESS', 'FINALISED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalised_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pods_wad ON public.pods(org_id, wad_id);

CREATE TABLE IF NOT EXISTS public.pod_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  pod_id uuid NOT NULL REFERENCES public.pods(id),
  name text NOT NULL,
  due_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'COMPLETED', 'OVERDUE')),
  evidence_document_id uuid,
  detected_deficiency_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_milestones_due ON public.pod_milestones(org_id, due_at);

CREATE TABLE IF NOT EXISTS public.breaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  pod_id uuid NOT NULL REFERENCES public.pods(id),
  milestone_id uuid REFERENCES public.pod_milestones(id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('RECORDED'))
);

CREATE TABLE IF NOT EXISTS public.compliance_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id),
  entity_id uuid NOT NULL REFERENCES public.entities(id),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  decision_notes text
);
CREATE INDEX IF NOT EXISTS idx_cases_entity ON public.compliance_cases(org_id, entity_id, status);

-- RLS
ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p3_wads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pod_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.breaches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_cases ENABLE ROW LEVEL SECURITY;

-- POIs RLS
CREATE POLICY "Service role manages pois" ON public.pois FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org pois" ON public.pois FOR ALL USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())) WITH CHECK (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all pois" ON public.pois FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- P3 WaDs RLS
CREATE POLICY "Service role manages p3_wads" ON public.p3_wads FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org p3_wads" ON public.p3_wads FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all p3_wads" ON public.p3_wads FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- PoDs RLS
CREATE POLICY "Service role manages pods" ON public.pods FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org pods" ON public.pods FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Pod milestones RLS
CREATE POLICY "Service role manages pod_milestones" ON public.pod_milestones FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org pod_milestones" ON public.pod_milestones FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- Breaches RLS
CREATE POLICY "Service role manages breaches" ON public.breaches FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org breaches" ON public.breaches FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all breaches" ON public.breaches FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- Compliance cases RLS
CREATE POLICY "Service role manages compliance_cases" ON public.compliance_cases FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role') WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org compliance_cases" ON public.compliance_cases FOR SELECT USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all compliance_cases" ON public.compliance_cases FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
