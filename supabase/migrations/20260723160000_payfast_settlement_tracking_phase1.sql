-- ============================================================
-- PayFast Settlement-to-Bank Tracking -- Phase 1 (backend foundation)
-- ============================================================
-- Builds the operational tracking layer for whether a completed
-- PayFast purchase has actually settled into Izenzo's bank account.
-- This migration does NOT touch token_purchases, token_ledger, wallet
-- balances, PayFast checkout, or PayFast ITN verification. It only
-- adds a new, standalone table plus governed RPCs.
--
-- Design reference: docs/payfast-settlement-tracking-build-plan-2026-07-23.md
--
-- Statuses (five, deliberately minimal): expected, confirmed, delayed,
-- exception, cancelled. reconciled is intentionally NOT used yet --
-- there is no real PayFast bank-settlement feed to reconcile against.

-- 1. Table -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_settlements (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider text NOT NULL CHECK (provider IN ('payfast')),
    provider_reference text NOT NULL,
    token_purchase_id uuid NOT NULL REFERENCES public.token_purchases(id) ON DELETE RESTRICT,
    org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
    amount_usd numeric CHECK (amount_usd IS NULL OR amount_usd >= 0),
    amount_zar numeric CHECK (amount_zar IS NULL OR amount_zar >= 0),
    usd_zar_rate numeric CHECK (usd_zar_rate IS NULL OR usd_zar_rate > 0),
    expected_settlement_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'expected'
      CHECK (status IN ('expected','confirmed','delayed','exception','cancelled')),
    settlement_confirmed_at timestamptz NULL,
    settlement_confirmed_by uuid NULL REFERENCES auth.users(id),
    bank_reference text NULL,
    exception_reason text NULL,
    exception_code text NULL,
    notes jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NULL REFERENCES auth.users(id),
    updated_by uuid NULL REFERENCES auth.users(id),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT payment_settlements_provider_reference_uidx UNIQUE (provider, provider_reference),
    CONSTRAINT payment_settlements_token_purchase_uidx UNIQUE (token_purchase_id),
    CONSTRAINT payment_settlements_confirmed_requires_bank_ref
      CHECK (status <> 'confirmed' OR bank_reference IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_payment_settlements_provider_status
  ON public.payment_settlements (provider, status);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_org
  ON public.payment_settlements (org_id);
CREATE INDEX IF NOT EXISTS idx_payment_settlements_expected_at
  ON public.payment_settlements (expected_settlement_at);

COMMENT ON TABLE public.payment_settlements IS
  'PayFast Settlement Tracking Phase 1. Tracks whether a completed PayFast purchase has settled into Izenzo bank account. Provider-generic shape; only provider=payfast is populated in Phase 1. Never stores real bank account or routing numbers -- bank_reference is an opaque operator-entered reference string only. Writes restricted to SECURITY DEFINER RPCs; RLS denies all direct client writes.';

DROP TRIGGER IF EXISTS trg_payment_settlements_updated_at ON public.payment_settlements;
CREATE TRIGGER trg_payment_settlements_updated_at
BEFORE UPDATE ON public.payment_settlements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Grants + RLS --------------------------------------------------
REVOKE ALL ON public.payment_settlements FROM anon, authenticated;
GRANT SELECT ON public.payment_settlements TO authenticated;
GRANT ALL ON public.payment_settlements TO service_role;

ALTER TABLE public.payment_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform admins and auditors read payment settlements" ON public.payment_settlements;
CREATE POLICY "platform admins and auditors read payment settlements"
ON public.payment_settlements
FOR SELECT
TO authenticated
USING (
    public.has_role(auth.uid(), 'platform_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'auditor'::public.app_role)
  );

-- 3. Helper: conservative business-day calculator ------------------
CREATE OR REPLACE FUNCTION public.add_business_days(p_start timestamptz, p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result timestamptz := p_start;
  v_remaining integer := p_days;
BEGIN
  IF p_start IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_days IS NULL OR p_days <= 0 THEN
    RETURN p_start;
  END IF;
  WHILE v_remaining > 0 LOOP
    v_result := v_result + interval '1 day';
    IF EXTRACT(ISODOW FROM v_result) < 6 THEN
      v_remaining := v_remaining - 1;
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.add_business_days(timestamptz, integer) IS
  'Conservative Mon-Fri business-day calculator, no public-holiday awareness. Used to derive payment_settlements.expected_settlement_at.';

-- 4. Reconciliation creator RPC --------------------------------------
CREATE OR REPLACE FUNCTION public.create_missing_payfast_settlements_v1(
    p_business_days integer DEFAULT 2
  )
RETURNS TABLE(inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH candidates AS (
        SELECT
          tp.id AS token_purchase_id,
          tp.org_id,
          tp.provider,
          tp.provider_reference,
          tp.updated_at,
          COALESCE(
            (tp.metadata->>'price_usd')::numeric,
            (tp.metadata->>'amount_usd')::numeric
          ) AS amount_usd,
          COALESCE(
            (tp.metadata->>'amount_zar')::numeric,
            (tp.metadata->>'price_zar')::numeric
          ) AS amount_zar,
          (tp.metadata->>'usd_zar_rate')::numeric AS usd_zar_rate
        FROM public.token_purchases tp
        WHERE tp.provider = 'payfast'
          AND tp.status = 'completed'
          AND tp.provider_reference IS NOT NULL
          AND tp.org_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM public.payment_settlements ps
            WHERE ps.token_purchase_id = tp.id
          )
      ),
  ins AS (
        INSERT INTO public.payment_settlements (
          provider, provider_reference, token_purchase_id, org_id,
          amount_usd, amount_zar, usd_zar_rate,
          expected_settlement_at, status, metadata
        )
        SELECT
          c.provider,
          c.provider_reference,
          c.token_purchase_id,
          c.org_id,
          c.amount_usd,
          c.amount_zar,
          c.usd_zar_rate,
          public.add_business_days(c.updated_at, p_business_days),
          'expected',
          jsonb_build_object(
            'source_purchase_id', c.token_purchase_id,
            'source_provider_reference', c.provider_reference,
            'creation_reason', 'reconciliation_scan',
            'expected_settlement_rule',
              'payment_confirmation_date_plus_' || p_business_days || '_business_days'
          )
        FROM candidates c
        ON CONFLICT (token_purchase_id) DO NOTHING
        RETURNING 1
      )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN QUERY SELECT v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_missing_payfast_settlements_v1(integer) TO authenticated;

COMMENT ON FUNCTION public.create_missing_payfast_settlements_v1(integer) IS
  'Idempotent PayFast settlement-tracking reconciliation job. Creates payment_settlements rows for completed PayFast purchases missing one. Never mutates token_purchases, token_ledger, or wallets. Never touches PayFast ITN or checkout.';

-- 5. Admin update RPC -------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_settlement_mark_v1(
    p_settlement_id uuid,
    p_action text,
    p_bank_reference text DEFAULT NULL,
    p_reason text DEFAULT NULL,
    p_note text DEFAULT NULL
  )
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_before public.payment_settlements%ROWTYPE;
  v_after public.payment_settlements%ROWTYPE;
  v_bank_ref text;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('confirm','delay','exception','cancel','add_note','set_bank_reference') THEN
    RAISE EXCEPTION 'invalid action %', p_action USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.payment_settlements WHERE id = p_settlement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'settlement not found' USING ERRCODE = 'P0002';
  END IF;

  v_bank_ref := COALESCE(p_bank_reference, v_before.bank_reference);

  IF p_action = 'confirm' THEN
    IF v_bank_ref IS NULL OR length(btrim(v_bank_ref)) = 0 THEN
      RAISE EXCEPTION 'bank_reference required to confirm settlement' USING ERRCODE = '22023';
    END IF;
    UPDATE public.payment_settlements
    SET status = 'confirmed',
        bank_reference = v_bank_ref,
        settlement_confirmed_at = now(),
        settlement_confirmed_by = v_uid,
        updated_by = v_uid
    WHERE id = p_settlement_id;

  ELSIF p_action = 'delay' THEN
    IF (p_reason IS NULL OR length(btrim(p_reason)) = 0)
       AND (p_note IS NULL OR length(btrim(p_note)) = 0) THEN
      RAISE EXCEPTION 'reason or note required to mark delayed' USING ERRCODE = '22023';
    END IF;
    UPDATE public.payment_settlements
    SET status = 'delayed',
        exception_reason = COALESCE(p_reason, exception_reason),
        notes = CASE WHEN p_note IS NOT NULL
          THEN notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_uid, 'note', p_note))
          ELSE notes END,
        updated_by = v_uid
    WHERE id = p_settlement_id;

  ELSIF p_action = 'exception' THEN
    IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
      RAISE EXCEPTION 'reason required to mark exception' USING ERRCODE = '22023';
    END IF;
    UPDATE public.payment_settlements
    SET status = 'exception',
        exception_reason = p_reason,
        updated_by = v_uid
    WHERE id = p_settlement_id;

  ELSIF p_action = 'cancel' THEN
    UPDATE public.payment_settlements
    SET status = 'cancelled',
        exception_reason = COALESCE(p_reason, exception_reason),
        updated_by = v_uid
    WHERE id = p_settlement_id;

  ELSIF p_action = 'add_note' THEN
    IF p_note IS NULL OR length(btrim(p_note)) = 0 THEN
      RAISE EXCEPTION 'note required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.payment_settlements
    SET notes = notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', v_uid, 'note', p_note)),
        updated_by = v_uid
    WHERE id = p_settlement_id;

  ELSIF p_action = 'set_bank_reference' THEN
    IF p_bank_reference IS NULL OR length(btrim(p_bank_reference)) = 0 THEN
      RAISE EXCEPTION 'bank_reference required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.payment_settlements
    SET bank_reference = p_bank_reference,
        updated_by = v_uid
    WHERE id = p_settlement_id;
  END IF;

  SELECT * INTO v_after FROM public.payment_settlements WHERE id = p_settlement_id;

  INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
  VALUES (
        v_uid,
        'payment_settlement.' || p_action,
        'payment_settlement',
        p_settlement_id,
        jsonb_build_object(
          'before_status', v_before.status,
          'after_status', v_after.status,
          'bank_reference_present', v_after.bank_reference IS NOT NULL,
          'reason_present', p_reason IS NOT NULL,
          'note_present', p_note IS NOT NULL
        )
      );

  IF v_after.status = 'exception' THEN
    INSERT INTO public.admin_risk_items (kind, severity, title, description, dedup_key, metadata, status, created_at, updated_at)
    VALUES (
          'payfast_settlement_exception',
          'high',
          'PayFast settlement marked exception',
          COALESCE(p_reason, 'Settlement marked exception by admin'),
          'payfast_settlement_exception:' || p_settlement_id::text,
          jsonb_build_object(
            'settlement_id', p_settlement_id,
            'token_purchase_id', v_after.token_purchase_id,
            'org_id', v_after.org_id
          ),
          'open', now(), now()
        )
    ON CONFLICT (dedup_key) DO UPDATE
    SET status = 'open', updated_at = now(), description = EXCLUDED.description;
  END IF;

  RETURN jsonb_build_object('id', p_settlement_id, 'status', v_after.status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.payment_settlement_mark_v1(uuid, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.payment_settlement_mark_v1(uuid, text, text, text, text) IS
  'Governed platform_admin-only settlement status/annotation update. Every call audit-logged to admin_audit_logs. Never touches wallet, ledger, PayFast ITN, or token_purchases.';

-- 6. Admin list RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_settlements_list_v1(
    p_status text DEFAULT NULL,
    p_provider text DEFAULT NULL,
    p_org_id uuid DEFAULT NULL,
    p_provider_reference text DEFAULT NULL,
    p_bank_reference text DEFAULT NULL,
    p_date_from timestamptz DEFAULT NULL,
    p_date_to timestamptz DEFAULT NULL,
    p_limit integer DEFAULT 200,
    p_offset integer DEFAULT 0
  )
RETURNS SETOF jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT (
      public.has_role(v_uid, 'platform_admin'::public.app_role)
      OR public.has_role(v_uid, 'auditor'::public.app_role)
    ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT jsonb_build_object(
        'id', ps.id,
        'token_purchase_id', ps.token_purchase_id,
        'provider', ps.provider,
        'provider_reference', ps.provider_reference,
        'org_id', ps.org_id,
        'org_name', o.name,
        'amount_usd', ps.amount_usd,
        'amount_zar', ps.amount_zar,
        'usd_zar_rate', ps.usd_zar_rate,
        'payment_confirmed_at', tp.updated_at,
        'wallet_credited_at', al.created_at,
        'expected_settlement_at', ps.expected_settlement_at,
        'status', ps.status,
        'settlement_confirmed_at', ps.settlement_confirmed_at,
        'bank_reference', ps.bank_reference,
        'exception_reason', ps.exception_reason,
        'exception_code', ps.exception_code,
        'notes', ps.notes,
        'has_refund_request', EXISTS (
          SELECT 1 FROM public.refund_requests rr WHERE rr.token_purchase_id = ps.token_purchase_id
        ),
        'has_payment_dispute', EXISTS (
          SELECT 1 FROM public.payment_disputes pd WHERE pd.token_purchase_id = ps.token_purchase_id
        ),
        'created_at', ps.created_at,
        'updated_at', ps.updated_at
      )
  FROM public.payment_settlements ps
  JOIN public.organizations o ON o.id = ps.org_id
  JOIN public.token_purchases tp ON tp.id = ps.token_purchase_id
  LEFT JOIN LATERAL (
        SELECT a.created_at
        FROM public.audit_logs a
        WHERE a.action = 'credits.purchased'
          AND a.org_id = ps.org_id
          AND (a.metadata->>'provider_reference') = ps.provider_reference
        ORDER BY a.created_at ASC
        LIMIT 1
      ) al ON true
  WHERE (p_status IS NULL OR ps.status = p_status)
    AND (p_provider IS NULL OR ps.provider = p_provider)
    AND (p_org_id IS NULL OR ps.org_id = p_org_id)
    AND (p_provider_reference IS NULL OR ps.provider_reference ILIKE '%' || p_provider_reference || '%')
    AND (p_bank_reference IS NULL OR ps.bank_reference ILIKE '%' || p_bank_reference || '%')
    AND (p_date_from IS NULL OR ps.created_at >= p_date_from)
    AND (p_date_to IS NULL OR ps.created_at <= p_date_to)
  ORDER BY ps.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 200), 1000))
  OFFSET GREATEST(0, COALESCE(p_offset, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.payment_settlements_list_v1(text, text, uuid, text, text, timestamptz, timestamptz, integer, integer) TO authenticated;

COMMENT ON FUNCTION public.payment_settlements_list_v1(text, text, uuid, text, text, timestamptz, timestamptz, integer, integer) IS
  'Admin/auditor read RPC for the future PayFast settlement reconciliation UI. platform_admin or auditor only.';

-- 7. Risk-item detection RPC --------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_payment_settlement_risks_v1(
    p_overdue_business_days integer DEFAULT 2,
    p_missing_settlement_hours integer DEFAULT 24
  )
RETURNS TABLE(inserted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inserted integer := 0;
BEGIN
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'platform_admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ins AS (
        INSERT INTO public.admin_risk_items (kind, severity, title, description, dedup_key, metadata, status, created_at, updated_at)
        SELECT
          'payfast_settlement_overdue',
          'medium',
          'PayFast settlement overdue',
          'Settlement ' || ps.id::text || ' still expected as of ' || ps.expected_settlement_at::text,
          'payfast_settlement_overdue:' || ps.id::text,
          jsonb_build_object('settlement_id', ps.id, 'token_purchase_id', ps.token_purchase_id, 'org_id', ps.org_id, 'expected_settlement_at', ps.expected_settlement_at),
          'open', now(), now()
        FROM public.payment_settlements ps
        WHERE ps.status = 'expected'
          AND ps.expected_settlement_at < now()
        ON CONFLICT (dedup_key) DO UPDATE
          SET status = 'open', updated_at = now()
        RETURNING 1
      )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH ins2 AS (
        INSERT INTO public.admin_risk_items (kind, severity, title, description, dedup_key, metadata, status, created_at, updated_at)
        SELECT
          'payfast_paid_no_settlement_record',
          'high',
          'Completed PayFast purchase has no settlement record',
          'token_purchases.' || tp.id::text || ' completed but no payment_settlements row exists',
          'payfast_paid_no_settlement_record:' || tp.id::text,
          jsonb_build_object('token_purchase_id', tp.id, 'org_id', tp.org_id, 'provider_reference', tp.provider_reference),
          'open', now(), now()
        FROM public.token_purchases tp
        WHERE tp.provider = 'payfast'
          AND tp.status = 'completed'
          AND tp.updated_at < now() - (p_missing_settlement_hours || ' hours')::interval
          AND NOT EXISTS (SELECT 1 FROM public.payment_settlements ps WHERE ps.token_purchase_id = tp.id)
        ON CONFLICT (dedup_key) DO UPDATE
          SET status = 'open', updated_at = now()
        RETURNING 1
      )
  SELECT v_inserted + count(*) INTO v_inserted FROM ins2;

  RETURN QUERY SELECT v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.detect_payment_settlement_risks_v1(integer, integer) TO authenticated;

COMMENT ON FUNCTION public.detect_payment_settlement_risks_v1(integer, integer) IS
  'Phase 1 risk-item scan for PayFast settlement tracking: overdue-expected settlements and paid purchases missing a settlement record. The exception alert is raised inline by payment_settlement_mark_v1.';
