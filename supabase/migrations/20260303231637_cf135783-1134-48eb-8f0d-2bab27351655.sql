
-- Break-glass actions table (append-only)
CREATE TABLE public.break_glass_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  org_id uuid REFERENCES public.organizations(id),
  action_type text NOT NULL CHECK (action_type IN ('freeze_org', 'freeze_api_keys', 'global_collapse_freeze', 'unfreeze_org', 'unfreeze_api_keys', 'global_collapse_unfreeze')),
  reason text NOT NULL,
  target_org_id uuid REFERENCES public.organizations(id),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.break_glass_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view break-glass actions" ON public.break_glass_actions FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'director'::app_role) OR has_role(auth.uid(), 'auditor'::app_role));

CREATE POLICY "Service role inserts break-glass" ON public.break_glass_actions FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Prevent mutations on break-glass log
CREATE OR REPLACE FUNCTION public.prevent_break_glass_mutation()
  RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'Break-glass log is append-only. No mutations permitted.';
END;
$$;

CREATE TRIGGER no_update_break_glass BEFORE UPDATE ON public.break_glass_actions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_break_glass_mutation();
CREATE TRIGGER no_delete_break_glass BEFORE DELETE ON public.break_glass_actions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_break_glass_mutation();

-- Data residency per org
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS data_region text DEFAULT 'za-south' NOT NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS cross_border_consent boolean DEFAULT false NOT NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS frozen boolean DEFAULT false NOT NULL;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS frozen_by uuid;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS frozen_reason text;

-- Global system freeze flag in admin_settings
INSERT INTO public.admin_settings (key, value)
VALUES ('collapse_freeze', '{"enabled": false, "frozen_by": null, "frozen_at": null, "reason": null}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- BRD constraints record (immutable governance)
CREATE TABLE public.brd_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  constraint_key text NOT NULL UNIQUE,
  description text NOT NULL,
  locked boolean NOT NULL DEFAULT true,
  current_value text NOT NULL,
  last_changed_at timestamptz DEFAULT now(),
  last_changed_by uuid,
  change_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.brd_constraints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view BRD constraints" ON public.brd_constraints FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Only directors can update BRD constraints" ON public.brd_constraints FOR UPDATE
  USING (has_role(auth.uid(), 'director'::app_role))
  WITH CHECK (has_role(auth.uid(), 'director'::app_role));

CREATE POLICY "Service role manages BRD constraints" ON public.brd_constraints FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- Seed BRD constraints
INSERT INTO public.brd_constraints (constraint_key, description, current_value) VALUES
  ('rpo_zero', 'Collapse ledger RPO = 0; synchronous replication before success response', 'enforced'),
  ('idempotency_mandatory', 'Idempotency key is mandatory and unique per org for collapse', 'enforced'),
  ('signed_payload_required', 'ECDSA signed payload required for all collapse requests', 'enforced'),
  ('partition_consistency', 'Collapse endpoint rejects requests during network partitions (CP mode)', 'enforced'),
  ('append_only_ledger', 'Collapse ledger is append-only; no UPDATE or DELETE permitted', 'enforced'),
  ('minimum_retention_years', 'Minimum data retention period before cold storage', '7'),
  ('hash_algorithm', 'Cryptographic hash algorithm for evidence chain integrity', 'SHA-256')
ON CONFLICT (constraint_key) DO NOTHING;

-- BRD change records table
CREATE TABLE public.brd_change_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  constraint_key text NOT NULL,
  old_value text NOT NULL,
  new_value text NOT NULL,
  requested_by uuid NOT NULL,
  approved_by uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.brd_change_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Directors and admins view change records" ON public.brd_change_records FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'director'::app_role) OR has_role(auth.uid(), 'auditor'::app_role));

CREATE POLICY "Service role manages change records" ON public.brd_change_records FOR ALL
  USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
