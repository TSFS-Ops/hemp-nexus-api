
-- =====================================================================
-- AI Counterparty Intelligence & Match Review — Batch 1 data layer
-- HQ-scoped (platform_admin only). No org_id; access gated by is_admin().
-- =====================================================================

-- 1) Trade-request interpretations -------------------------------------------------
CREATE TABLE public.ai_trade_request_interpretations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_request_id uuid NOT NULL,
  commodity_or_service text,
  side text CHECK (side IN ('buyer','seller','unknown')),
  geography text,
  quantity text,
  timing text,
  documentation_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  commercial_intent text,
  preferred_counterparty_type text,
  jurisdiction_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_indicators jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  ai_confidence text CHECK (ai_confidence IN ('low','medium','high')),
  raw_extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_trade_request_interpretations TO authenticated;
GRANT ALL ON public.ai_trade_request_interpretations TO service_role;
ALTER TABLE public.ai_trade_request_interpretations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_tri_admin_select" ON public.ai_trade_request_interpretations
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE INDEX ai_tri_trade_request_idx ON public.ai_trade_request_interpretations(trade_request_id);

-- 2) Proposed matches -------------------------------------------------------------
CREATE TABLE public.ai_proposed_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_request_id uuid NOT NULL,
  match_id uuid,
  interpretation_id uuid REFERENCES public.ai_trade_request_interpretations(id) ON DELETE SET NULL,
  suggested_counterparty_name text NOT NULL,
  suggested_counterparty_org_id uuid,
  counterparty_role text,
  jurisdiction text,
  sector_or_product_fit text,
  capacity_indicator text,
  prior_activity_summary text,
  source_summary text,
  source_references jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence_level text NOT NULL DEFAULT 'low' CHECK (confidence_level IN ('low','medium','high')),
  fit_label text NOT NULL DEFAULT 'possible_fit' CHECK (fit_label IN ('strong_fit','possible_fit','weak_fit')),
  rank_position integer,
  match_rationale text,
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  escalation_required boolean NOT NULL DEFAULT false,
  escalation_reason text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','under_review','needs_more_research','approved','rejected',
    'archived','escalated','outreach_draft_created'
  )),
  assigned_reviewer_id uuid,
  reviewer_note text,
  rejection_reason text,
  confidence_override text CHECK (confidence_override IN ('low','medium','high')),
  confidence_override_reason text,
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_proposed_matches TO authenticated;
GRANT ALL ON public.ai_proposed_matches TO service_role;
ALTER TABLE public.ai_proposed_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_pm_admin_select" ON public.ai_proposed_matches
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE INDEX ai_pm_trade_request_idx ON public.ai_proposed_matches(trade_request_id);
CREATE INDEX ai_pm_status_idx ON public.ai_proposed_matches(status);
CREATE INDEX ai_pm_created_at_idx ON public.ai_proposed_matches(created_at DESC);

-- 3) Outreach drafts v2 (separate from Phase 1 engagement_outreach_drafts) --------
CREATE TABLE public.ai_outreach_drafts_v2 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_match_id uuid NOT NULL REFERENCES public.ai_proposed_matches(id) ON DELETE CASCADE,
  trade_request_id uuid NOT NULL,
  recipient_name text,
  recipient_organisation text,
  recipient_email_if_known text,
  draft_subject text NOT NULL,
  draft_body text NOT NULL,
  draft_status text NOT NULL DEFAULT 'draft_created' CHECK (draft_status IN (
    'draft_created','under_review','approved_for_send','sent_by_human','rejected','archived'
  )),
  created_by_ai boolean NOT NULL DEFAULT true,
  created_by_user_id uuid,
  reviewed_by uuid,
  approved_for_send_by uuid,
  sent_by_user_id uuid,
  review_note text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  sent_at timestamptz
);
GRANT SELECT ON public.ai_outreach_drafts_v2 TO authenticated;
GRANT ALL ON public.ai_outreach_drafts_v2 TO service_role;
ALTER TABLE public.ai_outreach_drafts_v2 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_od2_admin_select" ON public.ai_outreach_drafts_v2
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE INDEX ai_od2_pm_idx ON public.ai_outreach_drafts_v2(proposed_match_id);
CREATE INDEX ai_od2_status_idx ON public.ai_outreach_drafts_v2(draft_status);

-- 4) POI intelligence notes -------------------------------------------------------
CREATE TABLE public.ai_poi_intelligence_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poi_id uuid,
  trade_request_id uuid,
  proposed_match_id uuid REFERENCES public.ai_proposed_matches(id) ON DELETE SET NULL,
  counterparty_name text,
  counterparty_org_id uuid,
  public_news_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_web_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  company_announcement_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  director_management_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  trade_activity_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  adverse_media_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  litigation_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  fraud_warning_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  social_media_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_summaries jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_classification text CHECK (source_classification IN (
    'verified_data','paid_provider','public_source','social_media','ai_interpretation'
  )) DEFAULT 'public_source',
  risk_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  supports_or_weakens text CHECK (supports_or_weakens IN ('supports','weakens','neutral')) DEFAULT 'neutral',
  escalation_required boolean NOT NULL DEFAULT false,
  escalation_reason text,
  model text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_poi_intelligence_notes TO authenticated;
GRANT ALL ON public.ai_poi_intelligence_notes TO service_role;
ALTER TABLE public.ai_poi_intelligence_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_pin_admin_select" ON public.ai_poi_intelligence_notes
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE INDEX ai_pin_poi_idx ON public.ai_poi_intelligence_notes(poi_id);
CREATE INDEX ai_pin_trade_request_idx ON public.ai_poi_intelligence_notes(trade_request_id);

-- 5) Do-not-contact rules ---------------------------------------------------------
CREATE TABLE public.ai_do_not_contact_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type text NOT NULL CHECK (rule_type IN (
    'specific_counterparty','jurisdiction','source_type','opportunity_type',
    'organisation','domain','email'
  )),
  rule_value text NOT NULL,
  reason text,
  created_by uuid,
  active boolean NOT NULL DEFAULT true,
  deactivated_at timestamptz,
  deactivated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_do_not_contact_rules TO authenticated;
GRANT ALL ON public.ai_do_not_contact_rules TO service_role;
ALTER TABLE public.ai_do_not_contact_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ai_dnc_admin_select" ON public.ai_do_not_contact_rules
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));
CREATE UNIQUE INDEX ai_dnc_unique_active_idx ON public.ai_do_not_contact_rules(rule_type, rule_value) WHERE active = true;

-- Shared updated_at trigger function (idempotent guard) ---------------------------
CREATE OR REPLACE FUNCTION public._ai_review_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER ai_tri_set_updated_at BEFORE UPDATE ON public.ai_trade_request_interpretations
  FOR EACH ROW EXECUTE FUNCTION public._ai_review_set_updated_at();
CREATE TRIGGER ai_pm_set_updated_at BEFORE UPDATE ON public.ai_proposed_matches
  FOR EACH ROW EXECUTE FUNCTION public._ai_review_set_updated_at();
CREATE TRIGGER ai_od2_set_updated_at BEFORE UPDATE ON public.ai_outreach_drafts_v2
  FOR EACH ROW EXECUTE FUNCTION public._ai_review_set_updated_at();
CREATE TRIGGER ai_pin_set_updated_at BEFORE UPDATE ON public.ai_poi_intelligence_notes
  FOR EACH ROW EXECUTE FUNCTION public._ai_review_set_updated_at();
CREATE TRIGGER ai_dnc_set_updated_at BEFORE UPDATE ON public.ai_do_not_contact_rules
  FOR EACH ROW EXECUTE FUNCTION public._ai_review_set_updated_at();
