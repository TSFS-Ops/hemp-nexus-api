
-- ============================================================
-- Batch 6 — Outreach (M013/M014), Operations (M015), Readiness (M017)
-- ============================================================

-- ---------- registry_outreach_templates ----------
CREATE TABLE public.registry_outreach_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  permitted_use_basis TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_outreach_templates_channel_chk CHECK (channel IN ('email','letter','internal_note'))
);
GRANT SELECT ON public.registry_outreach_templates TO authenticated;
GRANT ALL ON public.registry_outreach_templates TO service_role;
ALTER TABLE public.registry_outreach_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_templates admin read" ON public.registry_outreach_templates
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

-- ---------- registry_outreach_drafts ----------
CREATE TABLE public.registry_outreach_drafts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_kind TEXT NOT NULL, -- 'claim' | 'authority' | 'company'
  target_id TEXT NOT NULL,
  company_reference TEXT NOT NULL,
  country_code TEXT NOT NULL,
  channel TEXT NOT NULL,
  template_id UUID REFERENCES public.registry_outreach_templates(id),
  recipient_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft_requested',
  subject TEXT,
  body TEXT,
  ai_model TEXT,
  ai_confidence TEXT,
  reason_for_outreach TEXT NOT NULL,
  permitted_use_basis TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  requested_by UUID REFERENCES auth.users(id),
  generated_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  rejected_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_outreach_drafts_status_chk CHECK (status IN (
    'draft_requested','draft_generated','needs_review','edited','approved_for_send','rejected','cancelled','expired'
  )),
  CONSTRAINT registry_outreach_drafts_channel_chk CHECK (channel IN ('email','letter','internal_note')),
  CONSTRAINT registry_outreach_drafts_target_chk CHECK (target_kind IN ('claim','authority','company'))
);
CREATE INDEX idx_registry_outreach_drafts_status ON public.registry_outreach_drafts(status);
CREATE INDEX idx_registry_outreach_drafts_company ON public.registry_outreach_drafts(company_reference);
GRANT SELECT ON public.registry_outreach_drafts TO authenticated;
GRANT ALL ON public.registry_outreach_drafts TO service_role;
ALTER TABLE public.registry_outreach_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_drafts admin read" ON public.registry_outreach_drafts
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

CREATE OR REPLACE FUNCTION public.registry_outreach_drafts_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'registry_outreach_drafts status mutations require the audited registry-ai-outreach-draft / registry-outreach-review edge functions';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_registry_outreach_drafts_block_status
  BEFORE UPDATE ON public.registry_outreach_drafts
  FOR EACH ROW EXECUTE FUNCTION public.registry_outreach_drafts_block_status_mutation();

-- ---------- registry_outreach_draft_sources ----------
CREATE TABLE public.registry_outreach_draft_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES public.registry_outreach_drafts(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  snippet TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_outreach_draft_sources_draft ON public.registry_outreach_draft_sources(draft_id);
GRANT SELECT ON public.registry_outreach_draft_sources TO authenticated;
GRANT ALL ON public.registry_outreach_draft_sources TO service_role;
ALTER TABLE public.registry_outreach_draft_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_draft_sources admin read" ON public.registry_outreach_draft_sources
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

-- ---------- registry_outreach_draft_edits ----------
CREATE TABLE public.registry_outreach_draft_edits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES public.registry_outreach_drafts(id) ON DELETE CASCADE,
  previous_subject TEXT,
  previous_body TEXT,
  new_subject TEXT,
  new_body TEXT,
  editor_id UUID REFERENCES auth.users(id),
  edit_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_outreach_draft_edits_draft ON public.registry_outreach_draft_edits(draft_id);
GRANT SELECT ON public.registry_outreach_draft_edits TO authenticated;
GRANT ALL ON public.registry_outreach_draft_edits TO service_role;
ALTER TABLE public.registry_outreach_draft_edits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_draft_edits admin read" ON public.registry_outreach_draft_edits
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

-- ---------- registry_outreach_draft_events ----------
CREATE TABLE public.registry_outreach_draft_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES public.registry_outreach_drafts(id) ON DELETE CASCADE,
  audit_event_name TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT,
  reason TEXT,
  actor_id UUID REFERENCES auth.users(id),
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_registry_outreach_draft_events_draft ON public.registry_outreach_draft_events(draft_id);
GRANT SELECT ON public.registry_outreach_draft_events TO authenticated;
GRANT ALL ON public.registry_outreach_draft_events TO service_role;
ALTER TABLE public.registry_outreach_draft_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_draft_events admin read" ON public.registry_outreach_draft_events
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

-- ---------- registry_outreach_approvals ----------
CREATE TABLE public.registry_outreach_approvals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES public.registry_outreach_drafts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  decision TEXT,
  rationale TEXT,
  acknowledged_no_auto_send BOOLEAN NOT NULL DEFAULT false,
  reviewer_id UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_outreach_approvals_status_chk CHECK (status IN (
    'queued','in_review','approved','changes_requested','rejected','cancelled'
  )),
  CONSTRAINT registry_outreach_approvals_decision_chk CHECK (decision IS NULL OR decision IN (
    'approve','reject','request_changes','cancel'
  ))
);
CREATE INDEX idx_registry_outreach_approvals_draft ON public.registry_outreach_approvals(draft_id);
GRANT SELECT ON public.registry_outreach_approvals TO authenticated;
GRANT ALL ON public.registry_outreach_approvals TO service_role;
ALTER TABLE public.registry_outreach_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_approvals admin read" ON public.registry_outreach_approvals
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

CREATE OR REPLACE FUNCTION public.registry_outreach_approvals_block_status_mutation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'registry_outreach_approvals status mutations require the audited registry-outreach-review edge function';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_registry_outreach_approvals_block_status
  BEFORE UPDATE ON public.registry_outreach_approvals
  FOR EACH ROW EXECUTE FUNCTION public.registry_outreach_approvals_block_status_mutation();

-- ---------- registry_outreach_do_not_contact ----------
CREATE TABLE public.registry_outreach_do_not_contact (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_reference TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  reason TEXT NOT NULL,
  added_by UUID REFERENCES auth.users(id),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_dnc_at_least_one_identifier CHECK (
    company_reference IS NOT NULL OR contact_email IS NOT NULL OR contact_phone IS NOT NULL
  )
);
CREATE INDEX idx_registry_dnc_company ON public.registry_outreach_do_not_contact(company_reference);
CREATE INDEX idx_registry_dnc_email ON public.registry_outreach_do_not_contact(contact_email);
GRANT SELECT ON public.registry_outreach_do_not_contact TO authenticated;
GRANT ALL ON public.registry_outreach_do_not_contact TO service_role;
ALTER TABLE public.registry_outreach_do_not_contact ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_dnc admin read" ON public.registry_outreach_do_not_contact
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

-- ---------- registry_outreach_send_log ----------
CREATE TABLE public.registry_outreach_send_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  draft_id UUID NOT NULL REFERENCES public.registry_outreach_drafts(id) ON DELETE RESTRICT,
  approval_id UUID NOT NULL REFERENCES public.registry_outreach_approvals(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL,
  recipient_label TEXT NOT NULL,
  send_method TEXT NOT NULL DEFAULT 'manual_external',
  outcome TEXT NOT NULL,
  evidence_note TEXT,
  sent_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT registry_outreach_send_log_method_chk CHECK (send_method IN ('manual_external','internal_log_only')),
  CONSTRAINT registry_outreach_send_log_outcome_chk CHECK (outcome IN ('sent','failed','no_response','not_sent'))
);
CREATE INDEX idx_registry_outreach_send_log_draft ON public.registry_outreach_send_log(draft_id);
GRANT SELECT ON public.registry_outreach_send_log TO authenticated;
GRANT ALL ON public.registry_outreach_send_log TO service_role;
ALTER TABLE public.registry_outreach_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_send_log admin read" ON public.registry_outreach_send_log
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(),'platform_admin') OR public.has_role(auth.uid(),'compliance_owner')
  );

-- Block direct inserts into send log — must flow through edge function (service role).
CREATE OR REPLACE FUNCTION public.registry_outreach_send_log_block_direct_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'registry_outreach_send_log writes require the audited registry-outreach-log-send edge function';
END $$;
CREATE TRIGGER trg_registry_outreach_send_log_block_direct_insert
  BEFORE INSERT ON public.registry_outreach_send_log
  FOR EACH ROW EXECUTE FUNCTION public.registry_outreach_send_log_block_direct_insert();
