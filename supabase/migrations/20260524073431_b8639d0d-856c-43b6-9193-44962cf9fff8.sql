
-- DATA-005 Phase 1: user self-service export request skeleton.
-- Phase 2 (DATA-005-FU-EXPORT-LIFECYCLE-001) will add the signed-URL
-- file generation / download / destruction lifecycle. Phase 1 only
-- records the request + resolved scope + audit, no payload data.

CREATE TABLE IF NOT EXISTS public.user_export_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  org_id uuid NULL,
  status text NOT NULL DEFAULT 'requested',
  requested_categories text[] NOT NULL DEFAULT '{}',
  resolved_categories text[] NOT NULL DEFAULT '{}',
  block_reason text NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Status validation via trigger (not CHECK constraint, per project rule).
CREATE OR REPLACE FUNCTION public.validate_user_export_request_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status NOT IN (
    'requested','scope_resolved','blocked',
    'queued','generated','downloaded','expired','destroyed'
  ) THEN
    RAISE EXCEPTION 'invalid user_export_requests.status: %', NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_export_requests_validate
  ON public.user_export_requests;
CREATE TRIGGER trg_user_export_requests_validate
  BEFORE INSERT OR UPDATE ON public.user_export_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_user_export_request_status();

CREATE INDEX IF NOT EXISTS idx_user_export_requests_user_id
  ON public.user_export_requests (user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_export_requests_org_id
  ON public.user_export_requests (org_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_export_requests_status
  ON public.user_export_requests (status);

ALTER TABLE public.user_export_requests ENABLE ROW LEVEL SECURITY;

-- A user can read their own export requests.
DROP POLICY IF EXISTS "user_export_requests_select_own"
  ON public.user_export_requests;
CREATE POLICY "user_export_requests_select_own"
  ON public.user_export_requests
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Platform admins can read all rows.
DROP POLICY IF EXISTS "user_export_requests_select_admin"
  ON public.user_export_requests;
CREATE POLICY "user_export_requests_select_admin"
  ON public.user_export_requests
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

-- A user can insert only a row that belongs to themselves and starts
-- at the safe 'requested' status. The edge function uses service_role
-- and re-derives status/scope server-side; this client-facing policy
-- exists as a defensive belt-and-braces for any direct client insert.
DROP POLICY IF EXISTS "user_export_requests_insert_self"
  ON public.user_export_requests;
CREATE POLICY "user_export_requests_insert_self"
  ON public.user_export_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'requested'
    AND resolved_categories = '{}'::text[]
    AND block_reason IS NULL
  );

-- No UPDATE or DELETE policies for authenticated role: status
-- transitions (scope_resolved/blocked/queued/...) and any deletion
-- are service-role-only. service_role bypasses RLS automatically.
