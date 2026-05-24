-- DATA-003 Phase 1: legal_holds table
CREATE TABLE IF NOT EXISTS public.legal_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type text NOT NULL,
  scope_id uuid NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  applied_by uuid NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid NULL,
  released_at timestamptz NULL,
  released_reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legal_holds_scope_type_chk CHECK (
    scope_type IN (
      'user','org','match','engagement','poi','wad',
      'dispute','payment','evidence','record_group'
    )
  ),
  CONSTRAINT legal_holds_status_chk CHECK (status IN ('active','released')),
  CONSTRAINT legal_holds_reason_min_len CHECK (char_length(reason) >= 10),
  CONSTRAINT legal_holds_release_consistency CHECK (
    (status = 'active'  AND released_by IS NULL AND released_at IS NULL AND released_reason IS NULL)
    OR
    (status = 'released' AND released_by IS NOT NULL AND released_at IS NOT NULL
                         AND released_reason IS NOT NULL AND char_length(released_reason) >= 10)
  )
);

-- Indexes
CREATE INDEX IF NOT EXISTS legal_holds_scope_idx
  ON public.legal_holds (scope_type, scope_id, status);

CREATE INDEX IF NOT EXISTS legal_holds_status_applied_at_idx
  ON public.legal_holds (status, applied_at DESC);

CREATE INDEX IF NOT EXISTS legal_holds_applied_by_idx
  ON public.legal_holds (applied_by);

CREATE INDEX IF NOT EXISTS legal_holds_released_by_idx
  ON public.legal_holds (released_by);

-- At most one ACTIVE hold per (scope_type, scope_id). Released holds are
-- historical and may accumulate.
CREATE UNIQUE INDEX IF NOT EXISTS legal_holds_unique_active_scope
  ON public.legal_holds (scope_type, scope_id)
  WHERE status = 'active';

-- updated_at trigger (reuses project convention)
CREATE OR REPLACE FUNCTION public.legal_holds_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS legal_holds_touch_updated_at_trg ON public.legal_holds;
CREATE TRIGGER legal_holds_touch_updated_at_trg
BEFORE UPDATE ON public.legal_holds
FOR EACH ROW EXECUTE FUNCTION public.legal_holds_touch_updated_at();

-- RLS: platform_admin ONLY for all operations. Service-role bypasses RLS
-- and is used by the admin-legal-hold edge function + assertNoLegalHold
-- helper for enforcement queries.
ALTER TABLE public.legal_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS legal_holds_platform_admin_select ON public.legal_holds;
CREATE POLICY legal_holds_platform_admin_select
ON public.legal_holds
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::public.app_role));

DROP POLICY IF EXISTS legal_holds_platform_admin_insert ON public.legal_holds;
CREATE POLICY legal_holds_platform_admin_insert
ON public.legal_holds
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::public.app_role));

DROP POLICY IF EXISTS legal_holds_platform_admin_update ON public.legal_holds;
CREATE POLICY legal_holds_platform_admin_update
ON public.legal_holds
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::public.app_role));

-- No DELETE policy on purpose: legal hold rows are append/update-only.

COMMENT ON TABLE public.legal_holds IS
  'DATA-003 Phase 1: platform_admin-applied legal holds blocking deletion/anonymisation/purge/destruction for specified scopes.';
