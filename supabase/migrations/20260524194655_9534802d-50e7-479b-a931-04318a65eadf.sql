-- =====================================================================
-- OPS-010 Phase 2A — Demo workspace isolation
-- =====================================================================

-- 1) demo_workspaces registry --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.demo_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  dataset_id uuid NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','reset','archived')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  reset_at timestamptz,
  last_reset_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_demo_workspaces_org ON public.demo_workspaces(org_id);
CREATE INDEX IF NOT EXISTS idx_demo_workspaces_status ON public.demo_workspaces(status);

ALTER TABLE public.demo_workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "demo_workspaces_admin_select" ON public.demo_workspaces;
CREATE POLICY "demo_workspaces_admin_select"
ON public.demo_workspaces FOR SELECT
USING (public.is_admin(auth.uid()));

-- service_role uses bypass; no insert/update/delete policies for non-admins.

-- 2) Add is_demo + demo_dataset_id to all demo-touched tables -----------------
DO $$
DECLARE
  t record;
  tbls text[] := ARRAY[
    'profiles','trade_requests','pois','wads','token_ledger',
    'screening_runs','screening_results','compliance_cases','compliance_holds',
    'operator_verification_requests','engagement_outreach_logs','notifications',
    'webhook_events','audit_logs','dd_approval_requests',
    'organizations','matches','poi_engagements'
  ];
  tn text;
BEGIN
  FOREACH tn IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=tn
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false',
        tn
      );
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS demo_dataset_id uuid',
        tn
      );
    END IF;
  END LOOP;
END $$;

-- 3) Hot-path indexes ---------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_matches_demo ON public.matches(demo_dataset_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_pois_demo ON public.pois(demo_dataset_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_token_ledger_demo ON public.token_ledger(demo_dataset_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_audit_logs_demo ON public.audit_logs(demo_dataset_id) WHERE is_demo;
CREATE INDEX IF NOT EXISTS idx_orgs_demo ON public.organizations(demo_dataset_id) WHERE is_demo;

-- 4) Inheritance / boundary trigger ------------------------------------------
-- For any row inserted into a table that has both is_demo and demo_dataset_id,
-- if it references an org_id (or match_id, trade_request_id, poi_id) whose
-- parent is demo, force is_demo=true + inherit demo_dataset_id.
-- Reject any attempt to write a demo flag on a row whose parent is live, or
-- a live row whose parent is demo, with DEMO_BOUNDARY_VIOLATION.

CREATE OR REPLACE FUNCTION public.enforce_demo_inheritance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  parent_is_demo boolean;
  parent_dataset uuid;
  child_is_demo  boolean;
  child_dataset  uuid;
BEGIN
  -- Read child's current demo flags using JSON access (works generically).
  BEGIN
    child_is_demo := COALESCE((to_jsonb(NEW)->>'is_demo')::boolean, false);
  EXCEPTION WHEN OTHERS THEN child_is_demo := false;
  END;
  BEGIN
    child_dataset := NULLIF(to_jsonb(NEW)->>'demo_dataset_id','')::uuid;
  EXCEPTION WHEN OTHERS THEN child_dataset := NULL;
  END;

  -- Resolve parent demo state by checking org_id first.
  IF (to_jsonb(NEW) ? 'org_id') AND (to_jsonb(NEW)->>'org_id') IS NOT NULL THEN
    SELECT is_demo, demo_dataset_id
      INTO parent_is_demo, parent_dataset
    FROM public.organizations
    WHERE id = (to_jsonb(NEW)->>'org_id')::uuid;

    IF parent_is_demo IS TRUE THEN
      -- Force inherit
      NEW := jsonb_populate_record(
        NEW,
        jsonb_build_object('is_demo', true, 'demo_dataset_id', parent_dataset)
      );
    ELSIF parent_is_demo IS FALSE AND child_is_demo IS TRUE THEN
      RAISE EXCEPTION 'DEMO_BOUNDARY_VIOLATION: demo row attached to live org'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- Attach trigger to demo-touched tables that carry org_id.
DO $$
DECLARE
  tn text;
  tbls text[] := ARRAY[
    'profiles','trade_requests','matches','pois','wads','poi_engagements',
    'token_ledger','screening_runs','screening_results','compliance_cases',
    'compliance_holds','operator_verification_requests','engagement_outreach_logs',
    'notifications','webhook_events','audit_logs','dd_approval_requests'
  ];
BEGIN
  FOREACH tn IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=tn
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS enforce_demo_inheritance_trg ON public.%I', tn);
      EXECUTE format(
        'CREATE TRIGGER enforce_demo_inheritance_trg
         BEFORE INSERT OR UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.enforce_demo_inheritance()',
        tn
      );
    END IF;
  END LOOP;
END $$;

-- 5) SECDEF service_role-only governance RPCs ---------------------------------
CREATE OR REPLACE FUNCTION public.create_demo_workspace(
  p_admin_user_id uuid,
  p_org_name text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_dataset uuid := gen_random_uuid();
  v_org_id  uuid;
  v_ws_id   uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  -- Create the demo org (is_demo=true, dataset_id stamped).
  INSERT INTO public.organizations (name, status, is_demo, demo_dataset_id, data_region)
  VALUES (
    COALESCE(NULLIF(btrim(p_org_name), ''), 'OPS-010 Demo Org ' || substr(v_dataset::text, 1, 8)),
    'active', true, v_dataset, 'demo'
  )
  RETURNING id INTO v_org_id;

  INSERT INTO public.demo_workspaces (org_id, dataset_id, created_by, notes, metadata)
  VALUES (v_org_id, v_dataset, p_admin_user_id, p_reason,
          jsonb_build_object('action','create','reason', p_reason))
  RETURNING id INTO v_ws_id;

  INSERT INTO public.audit_logs (org_id, action, entity_type, entity_id, actor_user_id, metadata, is_demo, demo_dataset_id)
  VALUES (v_org_id, 'ops.demo_workspace_created', 'demo_workspace', v_ws_id, p_admin_user_id,
          jsonb_build_object('dataset_id', v_dataset, 'reason', p_reason),
          true, v_dataset);

  RETURN jsonb_build_object('workspace_id', v_ws_id, 'org_id', v_org_id, 'dataset_id', v_dataset);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.reset_demo_workspace(
  p_admin_user_id uuid,
  p_dataset_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id uuid;
  v_deleted jsonb := '{}'::jsonb;
  v_count int;
  tn text;
  tbls text[] := ARRAY[
    'engagement_outreach_logs','notifications','webhook_events','dd_approval_requests',
    'operator_verification_requests','compliance_holds','compliance_cases',
    'screening_results','screening_runs','token_ledger',
    'wads','pois','poi_engagements','matches','trade_requests'
  ];
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING ERRCODE = 'P0001';
  END IF;
  IF p_dataset_id IS NULL THEN
    RAISE EXCEPTION 'DATASET_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT org_id INTO v_org_id FROM public.demo_workspaces
   WHERE dataset_id = p_dataset_id AND status <> 'archived';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  -- Scoped delete: is_demo=true AND demo_dataset_id matches. NEVER deletes live rows.
  FOREACH tn IN ARRAY tbls LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name=tn AND column_name='demo_dataset_id'
    ) THEN
      EXECUTE format(
        'WITH d AS (DELETE FROM public.%I WHERE is_demo = true AND demo_dataset_id = $1 RETURNING 1)
         SELECT count(*) FROM d', tn
      ) INTO v_count USING p_dataset_id;
      v_deleted := v_deleted || jsonb_build_object(tn, v_count);
    END IF;
  END LOOP;

  UPDATE public.demo_workspaces
     SET status='reset', reset_at=now(), last_reset_by=p_admin_user_id,
         metadata = metadata || jsonb_build_object('last_reset_reason', p_reason, 'last_reset_counts', v_deleted)
   WHERE dataset_id = p_dataset_id;

  INSERT INTO public.audit_logs (org_id, action, entity_type, entity_id, actor_user_id, metadata, is_demo, demo_dataset_id)
  VALUES (v_org_id, 'ops.demo_workspace_reset', 'demo_workspace', NULL, p_admin_user_id,
          jsonb_build_object('dataset_id', p_dataset_id, 'reason', p_reason, 'counts', v_deleted),
          true, p_dataset_id);

  RETURN jsonb_build_object('dataset_id', p_dataset_id, 'org_id', v_org_id, 'counts', v_deleted);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.archive_demo_workspace(
  p_admin_user_id uuid,
  p_dataset_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_org_id uuid;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 20 THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.is_admin(p_admin_user_id) THEN
    RAISE EXCEPTION 'NOT_PLATFORM_ADMIN' USING ERRCODE = 'P0001';
  END IF;

  SELECT org_id INTO v_org_id FROM public.demo_workspaces WHERE dataset_id = p_dataset_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'WORKSPACE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.demo_workspaces
     SET status='archived', archived_at=now(), archived_by=p_admin_user_id,
         metadata = metadata || jsonb_build_object('archive_reason', p_reason)
   WHERE dataset_id = p_dataset_id;

  INSERT INTO public.audit_logs (org_id, action, entity_type, entity_id, actor_user_id, metadata, is_demo, demo_dataset_id)
  VALUES (v_org_id, 'ops.demo_workspace_archived', 'demo_workspace', NULL, p_admin_user_id,
          jsonb_build_object('dataset_id', p_dataset_id, 'reason', p_reason),
          true, p_dataset_id);

  RETURN jsonb_build_object('dataset_id', p_dataset_id, 'org_id', v_org_id, 'status','archived');
END;
$fn$;

-- 6) Lock SECDEF RPCs to service_role only (SECDEF Stage D1 pattern).
REVOKE ALL ON FUNCTION public.create_demo_workspace(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reset_demo_workspace(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.archive_demo_workspace(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_demo_workspace(uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reset_demo_workspace(uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.archive_demo_workspace(uuid,uuid,text) TO service_role;