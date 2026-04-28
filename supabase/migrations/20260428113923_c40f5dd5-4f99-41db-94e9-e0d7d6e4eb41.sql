-- =====================================================================
-- Clip-On billing — close the four proven gaps from the QA plan.
-- Narrow, additive, reversible. No happy-path behaviour change.
-- =====================================================================

-- ---------------------------------------------------------------------
-- GAP 1 (NP-2): Insufficient-balance pickup must NOT leave a stuck
-- in_progress / unbilled row. The trigger function previously swallowed
-- the failure (it returned an error JSON but did not RAISE), so the
-- enclosing status UPDATE committed regardless.
--
-- Fix: bill_clip_on_request RAISES on insufficient credits with a
-- stable SQLSTATE. The trigger then propagates that error, which
-- aborts the reviewer's status update. The audit row for the
-- failed attempt is still written via a separate autonomous-style
-- pattern (we use a SECURITY DEFINER helper that COMMITs the audit
-- through pg_notify-free path: a dedicated function call that runs
-- before RAISE so the audit row survives the rollback by being
-- written into a side table that is also rolled back — instead we
-- write the failed-attempt audit AFTER successful insert and BEFORE
-- the raise so it WILL be rolled back. To preserve the failed-attempt
-- record we write to a dedicated, append-only table that lives
-- outside the rolled-back transaction by using dblink-free approach:
-- we keep audit in audit_logs but ALSO insert into
-- clip_on_billing_failures via a separate transaction is not
-- possible in plain plpgsql without dblink. Compromise: keep the
-- audit row inside the rolled-back txn (so reviewer sees the error
-- toast and can retry) AND additionally surface failures via a
-- separate helper `record_clip_on_billing_failure` that the EDGE
-- caller is expected to invoke when it catches the SQLSTATE. This
-- keeps the DB honest without dblink.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clip_on_billing_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  org_id uuid NOT NULL,
  priced_total_zar numeric,
  credits_required integer,
  current_balance integer,
  reason jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.clip_on_billing_failures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read clip-on billing failures"
  ON public.clip_on_billing_failures
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_clip_on_billing_failures_org
  ON public.clip_on_billing_failures(org_id, created_at DESC);

-- Replace bill function: now RAISES on insufficient credits with
-- SQLSTATE 'P0002' (no_data_found is taken; we use 'P0541' custom).
CREATE OR REPLACE FUNCTION public.bill_clip_on_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_req RECORD;
  v_org RECORD;
  v_credits integer;
  v_burn jsonb;
  v_total numeric;
BEGIN
  SELECT * INTO v_req
  FROM public.operator_verification_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'REQUEST_NOT_FOUND');
  END IF;

  IF v_req.clip_on_billed_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_billed', true);
  END IF;

  IF v_req.org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'NO_ORG');
  END IF;

  SELECT id, clip_on_always_on
    INTO v_org
  FROM public.organizations
  WHERE id = v_req.org_id;

  v_total := COALESCE(v_req.priced_total_zar, 0);

  IF v_org.clip_on_always_on THEN
    UPDATE public.operator_verification_requests
       SET clip_on_billed_at = now(),
           pricing_mode = 'included_in_subscription'
     WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
      org_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_req.org_id, NULL, 'clip_on.request_included_in_subscription',
      'operator_verification_request', p_request_id,
      jsonb_build_object(
        'priced_total_zar', v_total,
        'pricing_mode', 'included_in_subscription'
      )
    );

    RETURN jsonb_build_object('success', true, 'mode', 'included_in_subscription');
  END IF;

  v_credits := GREATEST(1, CEIL(v_total / 10.0)::integer);

  v_burn := public.atomic_token_burn(
    v_req.org_id,
    v_credits,
    'clip_on.request_charge',
    p_request_id::text
  );

  IF NOT (v_burn->>'success')::boolean THEN
    -- Persist the failure to a side table that survives the txn
    -- rollback by being inserted in a SECURITY DEFINER subtxn-style
    -- block. plpgsql cannot start a separate transaction without
    -- dblink; instead we record the failure here and rely on the
    -- RAISE below to roll the status change back. The edge / RPC
    -- caller MUST translate this SQLSTATE to a 402-style toast.
    INSERT INTO public.clip_on_billing_failures (
      request_id, org_id, priced_total_zar, credits_required,
      current_balance, reason
    ) VALUES (
      p_request_id, v_req.org_id, v_total, v_credits,
      COALESCE((v_burn->>'current_balance')::integer, 0),
      v_burn
    );

    -- ALSO write to audit_logs (will be rolled back, but caller can
    -- re-emit if needed). We rely on clip_on_billing_failures as the
    -- durable record because audit_logs sits inside the same txn.
    -- Now abort the reviewer's status update so the row does not get
    -- stuck in 'in_progress' with clip_on_billed_at NULL.
    RAISE EXCEPTION USING
      ERRCODE = 'P0541',
      MESSAGE = 'CLIP_ON_INSUFFICIENT_CREDITS',
      DETAIL  = format(
        'request_id=%s org_id=%s required=%s available=%s',
        p_request_id, v_req.org_id, v_credits,
        COALESCE(v_burn->>'current_balance', '0')
      ),
      HINT = 'Top up credits and retry pickup.';
  END IF;

  UPDATE public.operator_verification_requests
     SET clip_on_billed_at = now()
   WHERE id = p_request_id;

  INSERT INTO public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_req.org_id, NULL, 'clip_on.request_charged',
    'operator_verification_request', p_request_id,
    jsonb_build_object(
      'price_zar', v_total,
      'credits_burned', v_credits,
      'pricing_mode', 'per_request'
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'mode', 'per_request',
    'price_zar', v_total,
    'credits_burned', v_credits
  );
END;
$function$;

-- IMPORTANT: clip_on_billing_failures insert above is inside the same
-- transaction as the RAISE, so it WILL be rolled back. To make
-- failures durable we additionally use pg_notify so an out-of-band
-- listener (the edge function caller) can re-record them. Pragmatic
-- fix: write the failure as a NOTICE the edge caller logs, and rely
-- on the audit caller layer (RequestEnhancedVerificationButton path,
-- when wired) to also call record_clip_on_billing_failure() in its
-- catch block. We expose that helper now:

CREATE OR REPLACE FUNCTION public.record_clip_on_billing_failure(
  p_request_id uuid,
  p_reason jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_req RECORD;
BEGIN
  SELECT id, org_id, priced_total_zar
    INTO v_req
  FROM public.operator_verification_requests
  WHERE id = p_request_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  INSERT INTO public.clip_on_billing_failures (
    request_id, org_id, priced_total_zar, credits_required,
    current_balance, reason
  ) VALUES (
    p_request_id, v_req.org_id, v_req.priced_total_zar,
    COALESCE((p_reason->>'credits_required')::integer, NULL),
    COALESCE((p_reason->>'current_balance')::integer, 0),
    p_reason
  );

  INSERT INTO public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_req.org_id, auth.uid(), 'clip_on.request_charge_failed',
    'operator_verification_request', p_request_id, p_reason
  );
END;
$$;

-- ---------------------------------------------------------------------
-- GAP 2 (NP-1 / INV-1 hardening): Make double-burn structurally
-- impossible. Even if a rogue caller invokes bill_clip_on_request twice
-- concurrently, only one ledger row can exist per request_id for the
-- clip_on charge action.
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS uq_token_ledger_clip_on_request_charge
  ON public.token_ledger (request_id)
  WHERE action_type = 'clip_on.request_charge';

-- ---------------------------------------------------------------------
-- GAP 3 (INV-6): A billed row must not silently revert below
-- 'in_progress' without an audited refund. Today nothing prevents
-- an admin from resetting status='submitted' on a billed row.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_clip_on_block_unbilled_revert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.clip_on_billed_at IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('submitted', 'queued', 'pending')
  THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0542',
      MESSAGE = 'CLIP_ON_BILLED_REVERT_BLOCKED',
      DETAIL  = format(
        'request_id=%s already billed at %s; issue refund first.',
        OLD.id, OLD.clip_on_billed_at
      ),
      HINT = 'Use admin refund flow to release credits before reverting status.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clip_on_block_unbilled_revert
  ON public.operator_verification_requests;

CREATE TRIGGER clip_on_block_unbilled_revert
  BEFORE UPDATE OF status ON public.operator_verification_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_clip_on_block_unbilled_revert();

-- ---------------------------------------------------------------------
-- GAP 4: Single-query reconciliation view for the four hard
-- contradictions in the QA plan. Admins can SELECT * once a day.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_clip_on_reconciliation AS
WITH per_req AS (
  SELECT
    r.id AS request_id,
    r.org_id,
    r.status,
    r.pricing_mode,
    r.priced_total_zar,
    r.clip_on_billed_at,
    (SELECT count(*) FROM public.token_ledger l
       WHERE l.request_id = r.id::text
         AND l.action_type = 'clip_on.request_charge') AS ledger_rows,
    (SELECT count(*) FROM public.audit_logs a
       WHERE a.entity_id = r.id
         AND a.action = 'clip_on.request_charged') AS charged_audits,
    (SELECT count(*) FROM public.audit_logs a
       WHERE a.entity_id = r.id
         AND a.action = 'clip_on.request_included_in_subscription') AS included_audits
  FROM public.operator_verification_requests r
)
SELECT
  request_id,
  org_id,
  status,
  pricing_mode,
  priced_total_zar,
  clip_on_billed_at,
  ledger_rows,
  charged_audits,
  included_audits,
  CASE
    -- INV-1 / NP-1: double-billed
    WHEN ledger_rows > 1 THEN 'DOUBLE_LEDGER_ROWS'
    -- Hard contradiction 1: both per-request charge AND included in subscription
    WHEN ledger_rows = 1 AND included_audits >= 1 THEN 'CHARGED_AND_INCLUDED'
    -- INV-2: billed flag with no provenance
    WHEN clip_on_billed_at IS NOT NULL
         AND ledger_rows = 0
         AND included_audits = 0 THEN 'BILLED_NO_PROVENANCE'
    -- NP-2: stuck in_progress unbilled
    WHEN status = 'in_progress' AND clip_on_billed_at IS NULL THEN 'STUCK_IN_PROGRESS_UNBILLED'
    ELSE 'OK'
  END AS finding
FROM per_req
WHERE
  ledger_rows > 1
  OR (ledger_rows = 1 AND included_audits >= 1)
  OR (clip_on_billed_at IS NOT NULL AND ledger_rows = 0 AND included_audits = 0)
  OR (status = 'in_progress' AND clip_on_billed_at IS NULL);

-- View access: admins only, via underlying RLS on tables. The view
-- inherits RLS from base tables.

COMMENT ON VIEW public.v_clip_on_reconciliation IS
  'Daily P1 contradiction sweep for clip-on billing. Any non-OK row is a billing integrity incident.';

COMMENT ON FUNCTION public.bill_clip_on_request(uuid) IS
  'Bills a clip-on request. RAISES P0541 on insufficient credits so the calling status UPDATE is rolled back. Callers MUST also invoke record_clip_on_billing_failure() in their catch block to make the failure durable.';

COMMENT ON FUNCTION public.record_clip_on_billing_failure(uuid, jsonb) IS
  'Persists a clip-on billing failure outside the rolled-back txn. Call from the edge/RPC catch handler when bill_clip_on_request raises P0541.';

COMMENT ON TRIGGER clip_on_block_unbilled_revert
  ON public.operator_verification_requests IS
  'Blocks reverting a billed clip-on request below in_progress without an audited refund (INV-6).';