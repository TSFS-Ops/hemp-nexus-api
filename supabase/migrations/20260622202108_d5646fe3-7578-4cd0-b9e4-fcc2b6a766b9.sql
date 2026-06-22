
-- =============================================================================
-- Point 6 — Admin / Client Usage Visibility
-- Unified read-only view + two role-gated row RPCs.
-- No changes to existing functions, tables, RLS, grants, ledger, or pricing.
-- =============================================================================

-- 1) Unified view: SECURITY INVOKER (default for views). Underlying
--    api_request_logs RLS still applies. Derived columns only.
CREATE OR REPLACE VIEW public.v_api_usage_unified AS
SELECT
  l.id,
  l.org_id,
  k.api_client_id,
  c.legal_entity_name                            AS api_client_name,
  l.api_key_id,
  k.name                                         AS api_key_alias,
  l.endpoint,
  l.method,
  COALESCE(l.environment, 'unknown')             AS environment,
  l.request_id,
  l.created_at,
  l.status_code,
  CASE
    WHEN l.status_code IS NULL                                 THEN 'unknown'
    WHEN l.status_code = 401 OR l.status_code = 403            THEN 'unauthorized'
    WHEN l.status_code = 429                                   THEN 'rate_limited'
    WHEN l.status_code >= 200 AND l.status_code < 300          THEN 'success'
    WHEN l.status_code >= 400                                  THEN 'error'
    ELSE 'other'
  END                                            AS status,
  COALESCE(l.billable, false)                    AS chargeable,
  l.non_billable_reason,
  l.error_code,
  COALESCE(l.token_cost_units, 0)                AS credits_burned,
  l.quota_position_after                         AS closing_balance,
  -- Derived only — NOT a new stored column.
  CASE
    WHEN COALESCE(l.billable, false)
         AND l.quota_position_after IS NOT NULL
         AND l.token_cost_units IS NOT NULL
      THEN l.quota_position_after + l.token_cost_units
    ELSE l.quota_position_after
  END                                            AS opening_balance,
  l.response_time_ms,
  l.external_reference
FROM public.api_request_logs l
LEFT JOIN public.api_keys     k ON k.id = l.api_key_id
LEFT JOIN public.api_clients  c ON c.id = k.api_client_id;

GRANT SELECT ON public.v_api_usage_unified TO authenticated;
GRANT SELECT ON public.v_api_usage_unified TO service_role;

COMMENT ON VIEW public.v_api_usage_unified IS
  'Point 6 unified usage read layer. Derived view over api_request_logs joined with api_keys and api_clients. No raw bodies, no key hashes, no IPs. opening_balance is derived (not a stored column).';

-- 2) Customer row RPC — caller can only see their own api_client.
--    Reuses existing can_view_api_client_usage (returns true for
--    platform_admin / api_admin / auditor / matching org_admin).
CREATE OR REPLACE FUNCTION public.get_api_client_usage_rows(
  p_api_client_id uuid,
  p_period_start  timestamptz,
  p_period_end    timestamptz,
  p_environment   text DEFAULT NULL,
  p_endpoint      text DEFAULT NULL,
  p_status        text DEFAULT NULL,
  p_chargeable    text DEFAULT NULL,    -- 'chargeable' | 'non_chargeable' | NULL
  p_api_key_alias text DEFAULT NULL,
  p_error_code    text DEFAULT NULL,
  p_limit         integer DEFAULT 200,
  p_offset        integer DEFAULT 0
)
RETURNS TABLE (
  id                  uuid,
  api_client_id       uuid,
  api_client_name     text,
  api_key_id          uuid,
  api_key_alias       text,
  endpoint            text,
  method              text,
  environment         text,
  request_id          text,
  created_at          timestamptz,
  status_code         integer,
  status              text,
  chargeable          boolean,
  non_billable_reason text,
  error_code          text,
  credits_burned      integer,
  closing_balance     integer,
  opening_balance     integer,
  response_time_ms    integer,
  external_reference  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);
BEGIN
  IF NOT public.can_view_api_client_usage(auth.uid(), p_api_client_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT v.id, v.api_client_id, v.api_client_name, v.api_key_id, v.api_key_alias,
         v.endpoint, v.method, v.environment, v.request_id, v.created_at,
         v.status_code, v.status, v.chargeable, v.non_billable_reason, v.error_code,
         v.credits_burned, v.closing_balance, v.opening_balance,
         v.response_time_ms, v.external_reference
  FROM public.v_api_usage_unified v
  WHERE v.api_client_id = p_api_client_id
    AND v.created_at >= p_period_start
    AND v.created_at <  p_period_end
    AND (p_environment   IS NULL OR v.environment = p_environment)
    AND (p_endpoint      IS NULL OR v.endpoint    = p_endpoint)
    AND (p_status        IS NULL OR v.status      = p_status)
    AND (p_chargeable    IS NULL OR
         (p_chargeable = 'chargeable'     AND v.chargeable = true) OR
         (p_chargeable = 'non_chargeable' AND v.chargeable = false))
    AND (p_api_key_alias IS NULL OR v.api_key_alias = p_api_key_alias)
    AND (p_error_code    IS NULL OR v.error_code    = p_error_code)
  ORDER BY v.created_at DESC
  LIMIT v_limit
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_api_client_usage_rows(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_api_client_usage_rows(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, integer, integer
) TO authenticated, service_role;

-- 3) Admin row RPC — any api_client, role-gated.
CREATE OR REPLACE FUNCTION public.get_api_admin_usage_rows(
  p_api_client_id uuid,
  p_period_start  timestamptz,
  p_period_end    timestamptz,
  p_environment   text DEFAULT NULL,
  p_endpoint      text DEFAULT NULL,
  p_status        text DEFAULT NULL,
  p_chargeable    text DEFAULT NULL,
  p_api_key_alias text DEFAULT NULL,
  p_error_code    text DEFAULT NULL,
  p_limit         integer DEFAULT 500,
  p_offset        integer DEFAULT 0
)
RETURNS TABLE (
  id                  uuid,
  org_id              uuid,
  api_client_id       uuid,
  api_client_name     text,
  api_key_id          uuid,
  api_key_alias       text,
  endpoint            text,
  method              text,
  environment         text,
  request_id          text,
  created_at          timestamptz,
  status_code         integer,
  status              text,
  chargeable          boolean,
  non_billable_reason text,
  error_code          text,
  credits_burned      integer,
  closing_balance     integer,
  opening_balance     integer,
  response_time_ms    integer,
  external_reference  text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF NOT (
       public.has_role(v_uid, 'platform_admin'::public.app_role)
    OR public.has_role(v_uid, 'api_admin'::public.app_role)
    OR public.has_role(v_uid, 'auditor'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT v.id, v.org_id, v.api_client_id, v.api_client_name, v.api_key_id, v.api_key_alias,
         v.endpoint, v.method, v.environment, v.request_id, v.created_at,
         v.status_code, v.status, v.chargeable, v.non_billable_reason, v.error_code,
         v.credits_burned, v.closing_balance, v.opening_balance,
         v.response_time_ms, v.external_reference
  FROM public.v_api_usage_unified v
  WHERE (p_api_client_id IS NULL OR v.api_client_id = p_api_client_id)
    AND v.created_at >= p_period_start
    AND v.created_at <  p_period_end
    AND (p_environment   IS NULL OR v.environment = p_environment)
    AND (p_endpoint      IS NULL OR v.endpoint    = p_endpoint)
    AND (p_status        IS NULL OR v.status      = p_status)
    AND (p_chargeable    IS NULL OR
         (p_chargeable = 'chargeable'     AND v.chargeable = true) OR
         (p_chargeable = 'non_chargeable' AND v.chargeable = false))
    AND (p_api_key_alias IS NULL OR v.api_key_alias = p_api_key_alias)
    AND (p_error_code    IS NULL OR v.error_code    = p_error_code)
  ORDER BY v.created_at DESC
  LIMIT v_limit
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_api_admin_usage_rows(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_api_admin_usage_rows(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, integer, integer
) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_api_client_usage_rows(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, integer, integer
) IS 'Point 6 customer usage rows. Scoped to caller''s own api_client via can_view_api_client_usage.';

COMMENT ON FUNCTION public.get_api_admin_usage_rows(
  uuid, timestamptz, timestamptz, text, text, text, text, text, text, integer, integer
) IS 'Point 6 admin usage rows. platform_admin, api_admin, or auditor only.';
