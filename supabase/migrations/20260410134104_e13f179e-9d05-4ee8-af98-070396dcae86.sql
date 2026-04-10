CREATE TABLE public.programmes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  budget_allocated NUMERIC NOT NULL DEFAULT 0,
  budget_committed NUMERIC NOT NULL DEFAULT 0,
  budget_disbursed NUMERIC NOT NULL DEFAULT 0,
  objectives JSONB DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.programme_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES public.entities(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'contractor',
  trade_approval_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  approved_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(programme_id, entity_id)
);

CREATE TABLE public.programme_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES public.programme_participants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  budget_tranche NUMERIC NOT NULL DEFAULT 0,
  evidence_document_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  verified_by UUID,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.fund_flows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  programme_id UUID NOT NULL REFERENCES public.programmes(id) ON DELETE CASCADE,
  milestone_id UUID REFERENCES public.programme_milestones(id),
  participant_id UUID NOT NULL REFERENCES public.programme_participants(id) ON DELETE CASCADE,
  flow_type TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'ZAR',
  reference TEXT,
  payload_hash TEXT NOT NULL,
  previous_hash TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.prevent_fund_flow_mutation()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  RAISE EXCEPTION 'fund_flows is append-only. No mutations permitted.';
END;
$fn$;

CREATE TRIGGER trg_fund_flows_no_update
  BEFORE UPDATE ON public.fund_flows
  FOR EACH ROW EXECUTE FUNCTION public.prevent_fund_flow_mutation();

CREATE TRIGGER trg_fund_flows_no_delete
  BEFORE DELETE ON public.fund_flows
  FOR EACH ROW EXECUTE FUNCTION public.prevent_fund_flow_mutation();

CREATE TRIGGER trg_programmes_updated_at
  BEFORE UPDATE ON public.programmes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_programme_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status NOT IN ('draft', 'active', 'reporting', 'closed') THEN
    RAISE EXCEPTION 'Invalid programme status: %. Must be draft, active, reporting, or closed.', NEW.status;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_validate_programme_status
  BEFORE INSERT OR UPDATE ON public.programmes
  FOR EACH ROW EXECUTE FUNCTION public.validate_programme_status();

CREATE OR REPLACE FUNCTION public.validate_participant_role()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.role NOT IN ('contractor', 'implementing_agent', 'beneficiary', 'oversight') THEN
    RAISE EXCEPTION 'Invalid participant role: %. Must be contractor, implementing_agent, beneficiary, or oversight.', NEW.role;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_validate_participant_role
  BEFORE INSERT OR UPDATE ON public.programme_participants
  FOR EACH ROW EXECUTE FUNCTION public.validate_participant_role();

CREATE OR REPLACE FUNCTION public.validate_milestone_status()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.status NOT IN ('pending', 'in_progress', 'completed', 'overdue', 'disputed') THEN
    RAISE EXCEPTION 'Invalid milestone status: %. Must be pending, in_progress, completed, overdue, or disputed.', NEW.status;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_validate_milestone_status
  BEFORE INSERT OR UPDATE ON public.programme_milestones
  FOR EACH ROW EXECUTE FUNCTION public.validate_milestone_status();

CREATE OR REPLACE FUNCTION public.validate_fund_flow_type()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $fn$
BEGIN
  IF NEW.flow_type NOT IN ('allocation', 'commitment', 'disbursement', 'return') THEN
    RAISE EXCEPTION 'Invalid fund flow type: %. Must be allocation, commitment, disbursement, or return.', NEW.flow_type;
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER trg_validate_fund_flow_type
  BEFORE INSERT ON public.fund_flows
  FOR EACH ROW EXECUTE FUNCTION public.validate_fund_flow_type();

ALTER TABLE public.programmes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.programme_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fund_flows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org programmes"
  ON public.programmes FOR SELECT TO authenticated
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can insert programmes"
  ON public.programmes FOR INSERT TO authenticated
  WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can update programmes"
  ON public.programmes FOR UPDATE TO authenticated
  USING (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()) OR public.is_admin(auth.uid()))
  WITH CHECK (org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid()) OR public.is_admin(auth.uid()));

CREATE POLICY "Users can view own org participants"
  ON public.programme_participants FOR SELECT TO authenticated
  USING (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can insert participants"
  ON public.programme_participants FOR INSERT TO authenticated
  WITH CHECK (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can update participants"
  ON public.programme_participants FOR UPDATE TO authenticated
  USING (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Users can view own org milestones"
  ON public.programme_milestones FOR SELECT TO authenticated
  USING (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can insert milestones"
  ON public.programme_milestones FOR INSERT TO authenticated
  WITH CHECK (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can update milestones"
  ON public.programme_milestones FOR UPDATE TO authenticated
  USING (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Users can view own org fund flows"
  ON public.fund_flows FOR SELECT TO authenticated
  USING (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE POLICY "Org admins can insert fund flows"
  ON public.fund_flows FOR INSERT TO authenticated
  WITH CHECK (programme_id IN (SELECT id FROM public.programmes WHERE org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())) OR public.is_admin(auth.uid()));

CREATE INDEX idx_programmes_org_id ON public.programmes(org_id);
CREATE INDEX idx_programmes_status ON public.programmes(status);
CREATE INDEX idx_programme_participants_programme_id ON public.programme_participants(programme_id);
CREATE INDEX idx_programme_participants_entity_id ON public.programme_participants(entity_id);
CREATE INDEX idx_programme_milestones_programme_id ON public.programme_milestones(programme_id);
CREATE INDEX idx_programme_milestones_status ON public.programme_milestones(status);
CREATE INDEX idx_fund_flows_programme_id ON public.fund_flows(programme_id);
CREATE INDEX idx_fund_flows_participant_id ON public.fund_flows(participant_id);