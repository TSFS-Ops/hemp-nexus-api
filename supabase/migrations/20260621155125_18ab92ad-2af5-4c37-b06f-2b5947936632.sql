
-- ── Lifecycle columns on registry_company_records ────────────────────────────
ALTER TABLE public.registry_company_records
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'imported_unverified',
  ADD COLUMN IF NOT EXISTS claim_activation_state text NOT NULL DEFAULT 'claim_not_available',
  ADD COLUMN IF NOT EXISTS claim_enabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_enabled_by uuid,
  ADD COLUMN IF NOT EXISTS claim_suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_suspended_by uuid,
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_review_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_after_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

-- Lifecycle events (append-only audit history)
CREATE TABLE IF NOT EXISTS public.registry_company_record_lifecycle_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  previous_state text,
  next_state text NOT NULL,
  transition_kind text NOT NULL,
  reason text NOT NULL,
  actor_user_id uuid,
  actor_role text,
  blocker_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_company_record_lifecycle_events TO authenticated;
GRANT ALL ON public.registry_company_record_lifecycle_events TO service_role;
ALTER TABLE public.registry_company_record_lifecycle_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lifecycle_events_admin_read"
  ON public.registry_company_record_lifecycle_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));
CREATE POLICY "lifecycle_events_service_write"
  ON public.registry_company_record_lifecycle_events FOR INSERT TO service_role WITH CHECK (true);

-- Claim activation reviews
CREATE TABLE IF NOT EXISTS public.registry_claim_activation_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  decision text NOT NULL,
  reason text NOT NULL,
  blocker_snapshot jsonb,
  reviewer_user_id uuid,
  reviewer_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_claim_activation_reviews TO authenticated;
GRANT ALL ON public.registry_claim_activation_reviews TO service_role;
ALTER TABLE public.registry_claim_activation_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activation_reviews_admin_read"
  ON public.registry_claim_activation_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));
CREATE POLICY "activation_reviews_service_write"
  ON public.registry_claim_activation_reviews FOR INSERT TO service_role WITH CHECK (true);

-- Claim availability checks (cached engine results)
CREATE TABLE IF NOT EXISTS public.registry_claim_availability_checks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  engine_result text NOT NULL,
  public_reason text,
  internal_reason text,
  blocker_snapshot jsonb,
  checked_by_user_id uuid,
  checked_by_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_claim_availability_checks TO authenticated;
GRANT ALL ON public.registry_claim_availability_checks TO service_role;
ALTER TABLE public.registry_claim_availability_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "availability_checks_admin_read"
  ON public.registry_claim_availability_checks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));
CREATE POLICY "availability_checks_service_write"
  ON public.registry_claim_availability_checks FOR INSERT TO service_role WITH CHECK (true);

-- Stale reviews
CREATE TABLE IF NOT EXISTS public.registry_record_stale_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started',
  owner_role text,
  outcome text,
  notes text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
GRANT SELECT ON public.registry_record_stale_reviews TO authenticated;
GRANT ALL ON public.registry_record_stale_reviews TO service_role;
ALTER TABLE public.registry_record_stale_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stale_reviews_admin_read"
  ON public.registry_record_stale_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));
CREATE POLICY "stale_reviews_service_write"
  ON public.registry_record_stale_reviews FOR INSERT TO service_role WITH CHECK (true);

-- Lifecycle notes
CREATE TABLE IF NOT EXISTS public.registry_record_lifecycle_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  record_id uuid NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  note text NOT NULL,
  author_user_id uuid,
  author_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.registry_record_lifecycle_notes TO authenticated;
GRANT ALL ON public.registry_record_lifecycle_notes TO service_role;
ALTER TABLE public.registry_record_lifecycle_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lifecycle_notes_admin_read"
  ON public.registry_record_lifecycle_notes FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin') OR public.has_role(auth.uid(), 'compliance_owner'));
CREATE POLICY "lifecycle_notes_service_write"
  ON public.registry_record_lifecycle_notes FOR INSERT TO service_role WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_record ON public.registry_company_record_lifecycle_events(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activation_reviews_record ON public.registry_claim_activation_reviews(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_availability_checks_record ON public.registry_claim_availability_checks(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stale_reviews_record ON public.registry_record_stale_reviews(record_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_notes_record ON public.registry_record_lifecycle_notes(record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_lifecycle_state ON public.registry_company_records(lifecycle_state);
CREATE INDEX IF NOT EXISTS idx_records_claim_activation_state ON public.registry_company_records(claim_activation_state);
CREATE INDEX IF NOT EXISTS idx_records_stale_after ON public.registry_company_records(stale_after_at) WHERE stale_after_at IS NOT NULL;
