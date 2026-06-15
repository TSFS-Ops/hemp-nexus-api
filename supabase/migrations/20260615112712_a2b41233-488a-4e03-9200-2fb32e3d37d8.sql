
-- =========================================================
-- Phase 1: AI Light-Intel V1 schema foundations
-- =========================================================

-- 1) Extend ai_proposed_matches ----------------------------
ALTER TABLE public.ai_proposed_matches
  ADD COLUMN IF NOT EXISTS due_at timestamptz,
  ADD COLUMN IF NOT EXISTS stale_at timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS original_payload jsonb,
  ADD COLUMN IF NOT EXISTS edited_payload jsonb,
  ADD COLUMN IF NOT EXISTS approved_payload jsonb,
  ADD COLUMN IF NOT EXISTS feedback_reason text;

-- Backfill stale_at / expires_at on existing rows
UPDATE public.ai_proposed_matches
SET stale_at = COALESCE(stale_at, created_at + interval '30 days'),
    expires_at = COALESCE(expires_at, created_at + interval '90 days')
WHERE stale_at IS NULL OR expires_at IS NULL;

-- Trigger to populate stale_at / expires_at on insert
CREATE OR REPLACE FUNCTION public.set_ai_proposed_match_lifecycle_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.stale_at IS NULL THEN
    NEW.stale_at := NEW.created_at + interval '30 days';
  END IF;
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.created_at + interval '90 days';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_proposed_matches_lifecycle_defaults ON public.ai_proposed_matches;
CREATE TRIGGER trg_ai_proposed_matches_lifecycle_defaults
BEFORE INSERT ON public.ai_proposed_matches
FOR EACH ROW EXECUTE FUNCTION public.set_ai_proposed_match_lifecycle_defaults();

-- Broaden status CHECK to full V1 vocabulary (additive — keep existing values)
ALTER TABLE public.ai_proposed_matches DROP CONSTRAINT IF EXISTS ai_proposed_matches_status_check;
ALTER TABLE public.ai_proposed_matches
  ADD CONSTRAINT ai_proposed_matches_status_check
  CHECK (status = ANY (ARRAY[
    'new'::text,
    'searching'::text,
    'results_found'::text,
    'no_results'::text,
    'pending_review'::text,
    'under_review'::text,
    'needs_more_research'::text,
    'approved'::text,
    'approved_internal'::text,
    'approved_client_view'::text,
    'outreach_draft_created'::text,
    'outreach_drafted'::text,
    'outreach_approved'::text,
    'outreach_sent'::text,
    'responded_interested'::text,
    'responded_not_interested'::text,
    'wrong_contact'::text,
    'bounced'::text,
    'converted_to_match'::text,
    'converted_to_poi'::text,
    'rejected'::text,
    'archived'::text,
    'closed'::text,
    'stale'::text,
    'escalated'::text
  ]));

-- Fixed feedback-reason enum (CHECK, nullable)
ALTER TABLE public.ai_proposed_matches DROP CONSTRAINT IF EXISTS ai_proposed_matches_feedback_reason_check;
ALTER TABLE public.ai_proposed_matches
  ADD CONSTRAINT ai_proposed_matches_feedback_reason_check
  CHECK (feedback_reason IS NULL OR feedback_reason = ANY (ARRAY[
    'wrong_company'::text,
    'wrong_country'::text,
    'wrong_product'::text,
    'wrong_counterparty_role'::text,
    'weak_source'::text,
    'bad_contact'::text,
    'dead_email'::text,
    'duplicate'::text,
    'possible_compliance_concern'::text,
    'poor_outreach_draft'::text,
    'not_commercially_relevant'::text,
    'insufficient_evidence'::text,
    'other'::text
  ]));

CREATE INDEX IF NOT EXISTS idx_ai_proposed_matches_stale_at ON public.ai_proposed_matches(stale_at);
CREATE INDEX IF NOT EXISTS idx_ai_proposed_matches_expires_at ON public.ai_proposed_matches(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_proposed_matches_client_visible ON public.ai_proposed_matches(client_visible) WHERE client_visible = true;

-- 2) ai_intel_sources --------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_intel_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_match_id uuid NOT NULL REFERENCES public.ai_proposed_matches(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  source_url text,
  source_title text,
  source_type text NOT NULL CHECK (source_type = ANY (ARRAY[
    'public_web'::text,
    'company_website'::text,
    'linkedin'::text,
    'b2bhint'::text,
    'cipc'::text,
    'companies_house'::text,
    'hunter'::text,
    'neverbounce'::text,
    'user_uploaded_document'::text,
    'izenzo_internal'::text,
    'africa_seed_db'::text,
    'approved_provider'::text,
    'other'::text
  ])),
  snippet text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  confidence text CHECK (confidence IS NULL OR confidence = ANY (ARRAY['low','medium','high'])),
  provider text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_intel_sources TO authenticated;
GRANT ALL ON public.ai_intel_sources TO service_role;

ALTER TABLE public.ai_intel_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_intel_sources_admin_all"
  ON public.ai_intel_sources
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_ai_intel_sources_proposed_match_id ON public.ai_intel_sources(proposed_match_id);
CREATE INDEX IF NOT EXISTS idx_ai_intel_sources_source_type ON public.ai_intel_sources(source_type);

-- 3) ai_intel_tasks ----------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_intel_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid REFERENCES public.matches(id) ON DELETE CASCADE,
  proposed_match_id uuid REFERENCES public.ai_proposed_matches(id) ON DELETE CASCADE,
  trade_request_id uuid REFERENCES public.trade_requests(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = ANY (ARRAY[
    'review_ai_result'::text,
    'approve_shortlist'::text,
    'approve_outreach'::text,
    'send_outreach'::text,
    'follow_up'::text,
    'mark_response'::text,
    'escalate_interested'::text,
    'escalate_to_verification'::text,
    'widen_search_criteria'::text,
    'verify_basic_details'::text,
    'invite_counterparty'::text,
    'link_to_match'::text,
    'notify_originator'::text,
    'provider_failure_review'::text,
    'other'::text
  ])),
  description text,
  owner uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status = ANY (ARRAY[
    'open'::text,
    'in_progress'::text,
    'blocked'::text,
    'done'::text,
    'cancelled'::text
  ])),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_note text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_intel_tasks TO authenticated;
GRANT ALL ON public.ai_intel_tasks TO service_role;

ALTER TABLE public.ai_intel_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_intel_tasks_admin_all"
  ON public.ai_intel_tasks
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_ai_intel_tasks_match_id ON public.ai_intel_tasks(match_id);
CREATE INDEX IF NOT EXISTS idx_ai_intel_tasks_proposed_match_id ON public.ai_intel_tasks(proposed_match_id);
CREATE INDEX IF NOT EXISTS idx_ai_intel_tasks_owner_status ON public.ai_intel_tasks(owner, status);
CREATE INDEX IF NOT EXISTS idx_ai_intel_tasks_status_due ON public.ai_intel_tasks(status, due_at);

CREATE OR REPLACE FUNCTION public.touch_ai_intel_tasks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_intel_tasks_updated_at ON public.ai_intel_tasks;
CREATE TRIGGER trg_ai_intel_tasks_updated_at
BEFORE UPDATE ON public.ai_intel_tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_ai_intel_tasks_updated_at();
