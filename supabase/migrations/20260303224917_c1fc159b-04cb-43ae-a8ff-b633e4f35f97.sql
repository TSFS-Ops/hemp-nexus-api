-- DD roles per org (separate from app_role enum to keep modularity)
CREATE TABLE public.dd_roles (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
user_id uuid NOT NULL,
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
role text NOT NULL CHECK (role IN ('compliance_analyst', 'legal_reviewer', 'director')),
created_at timestamptz NOT NULL DEFAULT now(),
UNIQUE(user_id, org_id, role)
);

-- Directors / shareholders / UBOs
CREATE TABLE public.org_directors (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
full_name text NOT NULL,
role text NOT NULL DEFAULT 'director',
nationality text,
id_number_hash text,
ownership_percentage numeric,
is_pep boolean DEFAULT false,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- KYC documents
CREATE TABLE public.kyc_documents (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
doc_type text NOT NULL,
filename text NOT NULL,
storage_path text NOT NULL,
mime_type text,
file_size integer,
sha256_hash text NOT NULL,
issuing_country text,
id_number_hash text,
expiry_date timestamptz,
extracted_metadata jsonb DEFAULT '{}'::jsonb,
status text NOT NULL DEFAULT 'uploaded',
uploaded_by uuid,
verified_at timestamptz,
verified_by uuid,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- KYC completeness per org
CREATE TABLE public.kyc_status (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
required_docs jsonb NOT NULL DEFAULT '["company_registration","proof_of_address","director_id","tax_certificate"]'::jsonb,
submitted_docs jsonb NOT NULL DEFAULT '[]'::jsonb,
completeness_percentage numeric NOT NULL DEFAULT 0,
status text NOT NULL DEFAULT 'incomplete',
last_reviewed_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Screening results
CREATE TABLE public.screening_results (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
screening_type text NOT NULL,
status text NOT NULL DEFAULT 'clear',
matched_entities jsonb DEFAULT '[]'::jsonb,
raw_response jsonb DEFAULT '{}'::jsonb,
screened_at timestamptz NOT NULL DEFAULT now(),
screened_by uuid,
next_screening_at timestamptz,
created_at timestamptz NOT NULL DEFAULT now()
);

-- Risk scores
CREATE TABLE public.dd_risk_scores (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
score numeric NOT NULL DEFAULT 0,
risk_band text NOT NULL DEFAULT 'low',
weights jsonb NOT NULL DEFAULT '{}'::jsonb,
factors jsonb NOT NULL DEFAULT '[]'::jsonb,
computed_at timestamptz NOT NULL DEFAULT now(),
computed_by uuid,
created_at timestamptz NOT NULL DEFAULT now()
);

-- Approval thresholds per org
CREATE TABLE public.approval_thresholds (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
low_threshold numeric NOT NULL DEFAULT 30,
high_threshold numeric NOT NULL DEFAULT 70,
updated_by uuid,
override_approved_by uuid,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Approval requests
CREATE TABLE public.dd_approval_requests (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
target_org_id uuid NOT NULL REFERENCES public.organizations(id),
requesting_org_id uuid NOT NULL REFERENCES public.organizations(id),
risk_score_id uuid REFERENCES public.dd_risk_scores(id),
status text NOT NULL DEFAULT 'pending',
required_roles text[] NOT NULL DEFAULT '{compliance_analyst}'::text[],
completed_roles text[] NOT NULL DEFAULT '{}'::text[],
reason text,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- Approval actions (append-only)
CREATE TABLE public.dd_approval_actions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
approval_request_id uuid NOT NULL REFERENCES public.dd_approval_requests(id),
actor_user_id uuid NOT NULL,
actor_role text NOT NULL,
action text NOT NULL,
reason text,
created_at timestamptz NOT NULL DEFAULT now()
);

-- Trade approval status
CREATE TABLE public.trade_approvals (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE UNIQUE,
status text NOT NULL DEFAULT 'not_approved',
approved_at timestamptz,
approved_by uuid,
approval_request_id uuid REFERENCES public.dd_approval_requests(id),
risk_band text,
valid_until timestamptz,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now()
);

-- KYC documents storage bucket (encrypted at rest by default)
INSERT INTO storage.buckets (id, name, public) VALUES ('kyc-documents', 'kyc-documents', false) ON CONFLICT (id) DO NOTHING;

-- Storage RLS for kyc-documents bucket
DROP POLICY IF EXISTS "Users upload kyc docs for own org" ON storage.objects;
CREATE POLICY "Users upload kyc docs for own org"
ON storage.objects FOR INSERT
WITH CHECK (
bucket_id = 'kyc-documents' AND
(storage.foldername(name))[1] IN (
SELECT org_id::text FROM profiles WHERE id = auth.uid()
)
);

DROP POLICY IF EXISTS "Users view kyc docs for own org" ON storage.objects;
CREATE POLICY "Users view kyc docs for own org"
ON storage.objects FOR SELECT
USING (
bucket_id = 'kyc-documents' AND
(storage.foldername(name))[1] IN (
SELECT org_id::text FROM profiles WHERE id = auth.uid()
)
);

DROP POLICY IF EXISTS "Service role manages kyc storage" ON storage.objects;
CREATE POLICY "Service role manages kyc storage"
ON storage.objects FOR ALL
USING (bucket_id = 'kyc-documents' AND (auth.jwt() ->> 'role') = 'service_role')
WITH CHECK (bucket_id = 'kyc-documents' AND (auth.jwt() ->> 'role') = 'service_role');

-- RLS on all DD tables
ALTER TABLE public.dd_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_directors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.screening_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dd_risk_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_thresholds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dd_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dd_approval_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_approvals ENABLE ROW LEVEL SECURITY;

-- Helper function to check DD roles
CREATE OR REPLACE FUNCTION public.has_dd_role(_user_id uuid, _org_id uuid, _role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
SELECT EXISTS (
SELECT 1 FROM public.dd_roles
WHERE user_id = _user_id AND org_id = _org_id AND role = _role
)
$$;

-- RLS Policies

-- dd_roles
CREATE POLICY "Service role manages dd_roles" ON public.dd_roles FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org dd_roles" ON public.dd_roles FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins manage all dd_roles" ON public.dd_roles FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- org_directors
CREATE POLICY "Service role manages org_directors" ON public.org_directors FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org directors" ON public.org_directors FOR ALL
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- kyc_documents
CREATE POLICY "Service role manages kyc_documents" ON public.kyc_documents FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users manage own org kyc docs" ON public.kyc_documents FOR ALL
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- kyc_status
CREATE POLICY "Service role manages kyc_status" ON public.kyc_status FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org kyc status" ON public.kyc_status FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- screening_results
CREATE POLICY "Service role manages screening_results" ON public.screening_results FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org screenings" ON public.screening_results FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));
CREATE POLICY "Admins view all screenings" ON public.screening_results FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- dd_risk_scores
CREATE POLICY "Service role manages dd_risk_scores" ON public.dd_risk_scores FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org risk scores" ON public.dd_risk_scores FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- approval_thresholds
CREATE POLICY "Service role manages thresholds" ON public.approval_thresholds FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org thresholds" ON public.approval_thresholds FOR SELECT
USING (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()));

-- dd_approval_requests
CREATE POLICY "Service role manages approval requests" ON public.dd_approval_requests FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view own org approval requests" ON public.dd_approval_requests FOR SELECT
USING (
requesting_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
OR target_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);

-- dd_approval_actions (append-only)
CREATE POLICY "Service role inserts approval actions" ON public.dd_approval_actions FOR INSERT
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Users view related approval actions" ON public.dd_approval_actions FOR SELECT
USING (approval_request_id IN (
SELECT id FROM dd_approval_requests
WHERE requesting_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
OR target_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
));

-- trade_approvals (status readable by any authenticated user)
CREATE POLICY "Service role manages trade approvals" ON public.trade_approvals FOR ALL
USING ((auth.jwt() ->> 'role') = 'service_role')
WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
CREATE POLICY "Authenticated users view trade approval status" ON public.trade_approvals FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX idx_org_directors_org_id ON public.org_directors(org_id);
CREATE INDEX idx_kyc_documents_org_id ON public.kyc_documents(org_id);
CREATE INDEX idx_screening_results_org_id ON public.screening_results(org_id);
CREATE INDEX idx_dd_risk_scores_org_id ON public.dd_risk_scores(org_id);
CREATE INDEX idx_dd_approval_requests_target ON public.dd_approval_requests(target_org_id);
CREATE INDEX idx_trade_approvals_org_id ON public.trade_approvals(org_id);
CREATE INDEX idx_dd_roles_user_org ON public.dd_roles(user_id, org_id);
