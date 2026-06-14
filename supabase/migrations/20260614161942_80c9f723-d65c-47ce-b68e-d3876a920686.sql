
-- Facilitation Phase 2 — Step 1 (retry with non-colliding index names)

-- 1. TEMPLATES
CREATE TABLE public.facilitation_outreach_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  subject text NOT NULL,
  body_text text NOT NULL,
  body_html text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
  version int NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.facilitation_outreach_templates TO authenticated;
GRANT ALL ON public.facilitation_outreach_templates TO service_role;
ALTER TABLE public.facilitation_outreach_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fot_select_admins" ON public.facilitation_outreach_templates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "fot_insert_platform_admin" ON public.facilitation_outreach_templates FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role));
CREATE POLICY "fot_update_platform_admin" ON public.facilitation_outreach_templates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role));

-- 2. CANDIDATES
CREATE TABLE public.facilitation_outreach_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facilitation_case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  contact_name text,
  contact_email text NOT NULL,
  contact_phone text,
  org_name text,
  org_website text,
  outreach_state text NOT NULL DEFAULT 'new'
    CHECK (outreach_state IN ('new','ready','sent','responded','declined','escalated','blocked','suppressed')),
  duplicate_check_result text CHECK (duplicate_check_result IS NULL OR duplicate_check_result IN ('green','amber','red')),
  dnc_check_result text CHECK (dnc_check_result IS NULL OR dnc_check_result IN ('clear','warn','block')),
  last_gate_evaluated_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_foc_case_p2 ON public.facilitation_outreach_candidates(facilitation_case_id);
CREATE INDEX idx_foc_state_p2 ON public.facilitation_outreach_candidates(outreach_state);
GRANT SELECT, INSERT, UPDATE ON public.facilitation_outreach_candidates TO authenticated;
GRANT ALL ON public.facilitation_outreach_candidates TO service_role;
ALTER TABLE public.facilitation_outreach_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "foc_select_admins" ON public.facilitation_outreach_candidates FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "foc_insert_platform_admin" ON public.facilitation_outreach_candidates FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role));
CREATE POLICY "foc_update_platform_admin" ON public.facilitation_outreach_candidates FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role));

-- 3. SENDS
CREATE TABLE public.facilitation_outreach_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.facilitation_outreach_candidates(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.facilitation_outreach_templates(id) ON DELETE RESTRICT,
  template_version int NOT NULL,
  idempotency_key text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','suppressed','blocked')),
  send_error text,
  email_send_log_id uuid,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, idempotency_key)
);
CREATE INDEX idx_fos_candidate_p2 ON public.facilitation_outreach_sends(candidate_id);
GRANT SELECT, INSERT, UPDATE ON public.facilitation_outreach_sends TO authenticated;
GRANT ALL ON public.facilitation_outreach_sends TO service_role;
ALTER TABLE public.facilitation_outreach_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fos_select_admins" ON public.facilitation_outreach_sends FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "fos_insert_platform_admin" ON public.facilitation_outreach_sends FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role));

-- 4. DO-NOT-CONTACT RULES
CREATE TABLE public.facilitation_do_not_contact_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_type text NOT NULL CHECK (rule_type IN ('email','domain','org_name')),
  value_raw text NOT NULL,
  value_norm text NOT NULL,
  match_severity text NOT NULL CHECK (match_severity IN ('block','warn')),
  reason text NOT NULL,
  source text NOT NULL CHECK (source IN ('compliance','legal','requester','sanctions_feed','manual_admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  revoked_reason text,
  expires_at timestamptz
);
CREATE UNIQUE INDEX idx_fdnc_active_unique_p2
  ON public.facilitation_do_not_contact_rules(rule_type, value_norm) WHERE status='active';
GRANT SELECT, INSERT, UPDATE ON public.facilitation_do_not_contact_rules TO authenticated;
GRANT ALL ON public.facilitation_do_not_contact_rules TO service_role;
ALTER TABLE public.facilitation_do_not_contact_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fdnc_select_admins" ON public.facilitation_do_not_contact_rules FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "fdnc_insert_admins" ON public.facilitation_do_not_contact_rules FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "fdnc_update_compliance_analyst" ON public.facilitation_do_not_contact_rules FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'compliance_analyst'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'compliance_analyst'::app_role));

CREATE OR REPLACE FUNCTION public.fdnc_enforce_revoke_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.rule_type IS DISTINCT FROM OLD.rule_type
     OR NEW.value_raw IS DISTINCT FROM OLD.value_raw
     OR NEW.value_norm IS DISTINCT FROM OLD.value_norm
     OR NEW.match_severity IS DISTINCT FROM OLD.match_severity
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'facilitation_do_not_contact_rules: only status flip to revoked allowed' USING ERRCODE='42501';
  END IF;
  IF OLD.status='revoked' THEN
    RAISE EXCEPTION 'facilitation_do_not_contact_rules: already revoked' USING ERRCODE='42501';
  END IF;
  IF NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'facilitation_do_not_contact_rules: only revoke transition allowed' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER fdnc_enforce_revoke_only_trg BEFORE UPDATE ON public.facilitation_do_not_contact_rules
  FOR EACH ROW EXECUTE FUNCTION public.fdnc_enforce_revoke_only();

-- 5. COMPLIANCE ESCALATIONS
CREATE TABLE public.facilitation_compliance_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES public.facilitation_outreach_candidates(id) ON DELETE CASCADE,
  facilitation_case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  reason text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  resolution_notes text,
  reopened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reopened_at timestamptz,
  reopened_reason text
);
CREATE INDEX idx_fcesc_candidate_status_p2 ON public.facilitation_compliance_escalations(candidate_id, status);
CREATE INDEX idx_fcesc_case_p2 ON public.facilitation_compliance_escalations(facilitation_case_id);
GRANT SELECT, INSERT, UPDATE ON public.facilitation_compliance_escalations TO authenticated;
GRANT ALL ON public.facilitation_compliance_escalations TO service_role;
ALTER TABLE public.facilitation_compliance_escalations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fcesc_select_admins" ON public.facilitation_compliance_escalations FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "fcesc_insert_admins" ON public.facilitation_compliance_escalations FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_analyst'::app_role));
CREATE POLICY "fcesc_update_compliance_analyst" ON public.facilitation_compliance_escalations FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'compliance_analyst'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'compliance_analyst'::app_role));

CREATE OR REPLACE FUNCTION public.fcesc_enforce_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.facilitation_case_id IS DISTINCT FROM OLD.facilitation_case_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'facilitation_compliance_escalations: immutable fields' USING ERRCODE='42501';
  END IF;
  IF OLD.status = NEW.status THEN
    RAISE EXCEPTION 'facilitation_compliance_escalations: status must change' USING ERRCODE='42501';
  END IF;
  IF OLD.status='open' AND NEW.status='resolved' THEN
    IF NEW.resolved_by IS NULL OR NEW.resolved_at IS NULL THEN
      RAISE EXCEPTION 'resolved_by/at required';
    END IF;
  ELSIF OLD.status='resolved' AND NEW.status='open' THEN
    IF NEW.reopened_by IS NULL OR NEW.reopened_at IS NULL OR NEW.reopened_reason IS NULL THEN
      RAISE EXCEPTION 'reopened_by/at/reason required';
    END IF;
  ELSE
    RAISE EXCEPTION 'illegal status transition % -> %', OLD.status, NEW.status USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER fcesc_enforce_transitions_trg BEFORE UPDATE ON public.facilitation_compliance_escalations
  FOR EACH ROW EXECUTE FUNCTION public.fcesc_enforce_transitions();

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER fot_set_updated_at BEFORE UPDATE ON public.facilitation_outreach_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER foc_set_updated_at BEFORE UPDATE ON public.facilitation_outreach_candidates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
