DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'org_retention_record_class') THEN
    CREATE TYPE public.org_retention_record_class AS ENUM (
      'matches','trade_requests','pois','wads','evidence',
      'audit_logs','email_send_log','governance_records'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public.org_retention_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  record_class    public.org_retention_record_class NOT NULL,
  retention_days  INTEGER NOT NULL CHECK (retention_days > 0),
  floor_days      INTEGER NOT NULL CHECK (floor_days > 0),
  reason          TEXT NOT NULL CHECK (char_length(trim(reason)) >= 10),
  set_by          UUID,
  set_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, record_class),
  CHECK (retention_days >= floor_days)
);

CREATE INDEX IF NOT EXISTS org_retention_policies_org_idx
  ON public.org_retention_policies (org_id);
CREATE INDEX IF NOT EXISTS org_retention_policies_class_idx
  ON public.org_retention_policies (record_class);

GRANT SELECT ON public.org_retention_policies TO authenticated;
GRANT ALL    ON public.org_retention_policies TO service_role;

ALTER TABLE public.org_retention_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "platform_admin reads all retention policies"
  ON public.org_retention_policies FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'));

-- Org members see only their own org's policy (membership = profiles.org_id).
CREATE POLICY "org members read their own retention policy"
  ON public.org_retention_policies FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.org_id = org_retention_policies.org_id
    )
  );

-- No client-side write policies — all writes go via service_role through
-- the admin-org-retention edge function.

CREATE TRIGGER org_retention_policies_updated_at
  BEFORE UPDATE ON public.org_retention_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_retention_floor_days(
  _record_class public.org_retention_record_class
) RETURNS INTEGER
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _record_class
    WHEN 'email_send_log' THEN 90
    ELSE 2555
  END;
$$;

CREATE OR REPLACE FUNCTION public.get_effective_retention_days(
  _org_id UUID,
  _record_class public.org_retention_record_class
) RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT retention_days FROM public.org_retention_policies
       WHERE org_id = _org_id AND record_class = _record_class LIMIT 1),
    public.get_retention_floor_days(_record_class)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_retention_days(UUID, public.org_retention_record_class) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_retention_floor_days(public.org_retention_record_class) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.atomic_org_retention_set(p_input JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID; v_record_class public.org_retention_record_class;
  v_retention_days INTEGER; v_reason TEXT; v_set_by UUID;
  v_metadata JSONB; v_floor INTEGER;
  v_existing public.org_retention_policies%ROWTYPE;
  v_action TEXT; v_row public.org_retention_policies%ROWTYPE;
BEGIN
  v_org_id := (p_input->>'org_id')::UUID;
  v_record_class := (p_input->>'record_class')::public.org_retention_record_class;
  v_retention_days := (p_input->>'retention_days')::INTEGER;
  v_reason := p_input->>'reason';
  v_set_by := NULLIF(p_input->>'set_by','')::UUID;
  v_metadata := COALESCE(p_input->'metadata','{}'::jsonb);

  IF v_org_id IS NULL OR v_record_class IS NULL OR v_retention_days IS NULL OR v_reason IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_INPUT');
  END IF;

  v_floor := public.get_retention_floor_days(v_record_class);
  IF v_retention_days < v_floor THEN
    RETURN jsonb_build_object('success',false,'error','BELOW_FLOOR','floor_days',v_floor,'requested_days',v_retention_days);
  END IF;

  SELECT * INTO v_existing FROM public.org_retention_policies
    WHERE org_id=v_org_id AND record_class=v_record_class FOR UPDATE;

  IF FOUND THEN
    v_action := 'updated';
    UPDATE public.org_retention_policies SET
      retention_days=v_retention_days, floor_days=v_floor,
      reason=v_reason, set_by=v_set_by, set_at=now(),
      metadata=v_metadata, updated_at=now()
    WHERE id=v_existing.id RETURNING * INTO v_row;
  ELSE
    v_action := 'created';
    INSERT INTO public.org_retention_policies
      (org_id, record_class, retention_days, floor_days, reason, set_by, metadata)
      VALUES (v_org_id, v_record_class, v_retention_days, v_floor, v_reason, v_set_by, v_metadata)
      RETURNING * INTO v_row;
  END IF;

  RETURN jsonb_build_object(
    'success',true,'action',v_action,'policy_id',v_row.id,
    'org_id',v_row.org_id,'record_class',v_row.record_class,
    'retention_days',v_row.retention_days,'floor_days',v_row.floor_days,
    'previous_retention_days',v_existing.retention_days,'set_at',v_row.set_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.atomic_org_retention_clear(p_input JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org_id UUID; v_record_class public.org_retention_record_class;
  v_reason TEXT; v_existing public.org_retention_policies%ROWTYPE;
BEGIN
  v_org_id := (p_input->>'org_id')::UUID;
  v_record_class := (p_input->>'record_class')::public.org_retention_record_class;
  v_reason := p_input->>'reason';
  IF v_org_id IS NULL OR v_record_class IS NULL OR v_reason IS NULL THEN
    RETURN jsonb_build_object('success',false,'error','INVALID_INPUT');
  END IF;

  SELECT * INTO v_existing FROM public.org_retention_policies
    WHERE org_id=v_org_id AND record_class=v_record_class FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success',false,'error','NOT_FOUND');
  END IF;

  DELETE FROM public.org_retention_policies WHERE id=v_existing.id;

  RETURN jsonb_build_object(
    'success',true,'cleared_policy_id',v_existing.id,
    'org_id',v_existing.org_id,'record_class',v_existing.record_class,
    'previous_retention_days',v_existing.retention_days,
    'floor_days',public.get_retention_floor_days(v_existing.record_class)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_org_retention_set(JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_org_retention_set(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.atomic_org_retention_clear(JSONB) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.atomic_org_retention_clear(JSONB) TO service_role;