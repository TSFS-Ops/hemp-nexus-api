
-- ============================================================
-- DEC-007 / PAY-009 Phase 2 — Refund + Payment Dispute Governance
-- ============================================================

-- 1. Billing hold fields on organizations (distinct from `frozen`)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_hold BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS billing_hold_reason TEXT,
  ADD COLUMN IF NOT EXISTS billing_hold_applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS billing_hold_applied_by UUID REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS idx_organizations_billing_hold
  ON public.organizations(id) WHERE billing_hold = true;

-- 2. refund_requests
CREATE TABLE IF NOT EXISTS public.refund_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  token_purchase_id UUID NOT NULL REFERENCES public.token_purchases(id) ON DELETE RESTRICT,
  reason_code TEXT NOT NULL CHECK (reason_code IN (
    'unused_within_window','unused_outside_window','accidental_purchase',
    'duplicate_purchase','service_dissatisfaction','other'
  )),
  reason_detail TEXT NOT NULL CHECK (char_length(reason_detail) >= 20),
  credits_at_request INTEGER NOT NULL CHECK (credits_at_request >= 0),
  credits_used_at_request INTEGER NOT NULL CHECK (credits_used_at_request >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending','approved','declined','blocked_credits_used','blocked_expired','superseded'
  )),
  decision_reason TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  ledger_adjustment_id UUID REFERENCES public.token_ledger(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_requests_open_per_purchase
  ON public.refund_requests(token_purchase_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_refund_requests_org_status
  ON public.refund_requests(org_id, status, created_at DESC);

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read own refund requests"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (org_id IN (
    SELECT p.org_id FROM public.profiles p
    WHERE p.id = auth.uid() AND p.org_id IS NOT NULL
  ));

CREATE POLICY "Platform admins read all refund requests"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_refund_requests_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. payment_disputes
CREATE TABLE IF NOT EXISTS public.payment_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  token_purchase_id UUID REFERENCES public.token_purchases(id),
  provider TEXT NOT NULL DEFAULT 'paystack',
  provider_dispute_reference TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('webhook','manual_admin')),
  credits_issued INTEGER NOT NULL CHECK (credits_issued >= 0),
  credits_used_at_open INTEGER NOT NULL CHECK (credits_used_at_open >= 0),
  credits_frozen INTEGER NOT NULL DEFAULT 0 CHECK (credits_frozen >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost','merchant_accepted')),
  resolution_reason TEXT,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ,
  disputed_credit_hold_id UUID REFERENCES public.disputed_credit_holds(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_disputes_org_status
  ON public.payment_disputes(org_id, status, created_at DESC);

ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read own payment disputes"
  ON public.payment_disputes FOR SELECT TO authenticated
  USING (org_id IN (
    SELECT p.org_id FROM public.profiles p
    WHERE p.id = auth.uid() AND p.org_id IS NOT NULL
  ));

CREATE POLICY "Platform admins read all payment disputes"
  ON public.payment_disputes FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER trg_payment_disputes_updated_at
  BEFORE UPDATE ON public.payment_disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. payment_dispute_affected_burns (additive; never deletes ledger)
CREATE TABLE IF NOT EXISTS public.payment_dispute_affected_burns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_dispute_id UUID NOT NULL REFERENCES public.payment_disputes(id) ON DELETE RESTRICT,
  token_ledger_id UUID NOT NULL REFERENCES public.token_ledger(id) ON DELETE RESTRICT,
  billing_review_required BOOLEAN NOT NULL DEFAULT true,
  cleared_at TIMESTAMPTZ,
  cleared_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payment_dispute_id, token_ledger_id)
);

ALTER TABLE public.payment_dispute_affected_burns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins read affected burns"
  ON public.payment_dispute_affected_burns FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_pdab_dispute ON public.payment_dispute_affected_burns(payment_dispute_id);
CREATE INDEX IF NOT EXISTS idx_pdab_ledger  ON public.payment_dispute_affected_burns(token_ledger_id);

-- ============================================================
-- 5. SECDEF RPCs (service_role-only EXECUTE)
-- ============================================================

-- helper: tally org credits used since a given purchase (best-effort by amount comparison)
-- We rely on token_balances + the purchase token_amount to estimate burned.

-- 5.1 request_refund
CREATE OR REPLACE FUNCTION public.request_refund(
  p_org_id UUID,
  p_user_id UUID,
  p_token_purchase_id UUID,
  p_reason_code TEXT,
  p_reason_detail TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_purchase RECORD;
  v_balance INTEGER;
  v_credits_used INTEGER;
  v_status TEXT := 'pending';
  v_now TIMESTAMPTZ := now();
  v_age INTERVAL;
  v_id UUID;
  v_audit_action TEXT;
BEGIN
  IF p_reason_detail IS NULL OR char_length(p_reason_detail) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;

  SELECT * INTO v_purchase FROM public.token_purchases
    WHERE id = p_token_purchase_id AND org_id = p_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'PURCHASE_NOT_FOUND');
  END IF;

  IF v_purchase.status <> 'completed' THEN
    RETURN jsonb_build_object('success', false, 'code', 'PURCHASE_NOT_SETTLED');
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
    FROM public.token_balances WHERE org_id = p_org_id;

  v_credits_used := GREATEST(0, v_purchase.token_amount - COALESCE(v_balance, 0));
  v_age := v_now - v_purchase.created_at;

  -- All burned → blocked_credits_used
  IF v_credits_used >= v_purchase.token_amount THEN
    v_status := 'blocked_credits_used';
    v_audit_action := 'billing.refund_blocked_credits_used';
  ELSIF v_age > interval '180 days' THEN
    v_status := 'blocked_expired';
    v_audit_action := 'billing.refund_blocked_credits_expired';
  ELSE
    v_status := 'pending';
    v_audit_action := 'billing.refund_requested';
  END IF;

  -- Reject duplicate pending requests for same purchase
  IF v_status = 'pending' AND EXISTS (
    SELECT 1 FROM public.refund_requests
    WHERE token_purchase_id = p_token_purchase_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_PENDING');
  END IF;

  INSERT INTO public.refund_requests (
    org_id, requested_by, token_purchase_id, reason_code, reason_detail,
    credits_at_request, credits_used_at_request, status, metadata
  ) VALUES (
    p_org_id, p_user_id, p_token_purchase_id, p_reason_code, p_reason_detail,
    COALESCE(v_balance, 0), v_credits_used, v_status,
    jsonb_build_object('purchase_amount', v_purchase.token_amount,
                       'purchase_created_at', v_purchase.created_at)
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (p_org_id, 'refund_request', v_id, v_audit_action,
    jsonb_build_object(
      'token_purchase_id', p_token_purchase_id,
      'reason_code', p_reason_code,
      'credits_at_request', COALESCE(v_balance, 0),
      'credits_used_at_request', v_credits_used,
      'status', v_status,
      'source_function', 'request_refund'
    ));

  RETURN jsonb_build_object('success', true, 'refund_request_id', v_id, 'status', v_status);
END;
$$;

-- 5.2 approve_refund
CREATE OR REPLACE FUNCTION public.approve_refund(
  p_refund_request_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rr RECORD;
  v_purchase RECORD;
  v_new_balance INTEGER;
  v_ledger_id UUID;
  v_correlation TEXT;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_rr FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND');
  END IF;
  IF v_rr.status <> 'pending' THEN
    RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_DECIDED');
  END IF;

  SELECT * INTO v_purchase FROM public.token_purchases WHERE id = v_rr.token_purchase_id;

  -- append-only refund ledger row (negative tokens_burned reflects credit removal)
  v_correlation := 'refund_req_' || v_rr.id::text;

  -- Decrement balance to reflect refund (will not go negative)
  UPDATE public.token_balances
    SET balance = GREATEST(0, balance - v_rr.credits_at_request)
    WHERE org_id = v_rr.org_id
    RETURNING balance INTO v_new_balance;

  INSERT INTO public.token_ledger (
    org_id, endpoint, tokens_burned, outcome, remaining_balance,
    request_id, action_type, entity_id, metadata
  ) VALUES (
    v_rr.org_id, 'refund', v_rr.credits_at_request, 'allowed', COALESCE(v_new_balance, 0),
    v_correlation, 'refund', v_rr.id,
    jsonb_build_object(
      'refund_request_id', v_rr.id,
      'token_purchase_id', v_rr.token_purchase_id,
      'approved_by', p_admin_user_id,
      'reason', p_reason,
      'source', 'approve_refund'
    )
  ) RETURNING id INTO v_ledger_id;

  UPDATE public.refund_requests
    SET status = 'approved',
        decision_reason = p_reason,
        reviewed_by = p_admin_user_id,
        reviewed_at = now(),
        ledger_adjustment_id = v_ledger_id
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_approved',
    jsonb_build_object('approved_by', p_admin_user_id, 'reason', p_reason,
                       'ledger_id', v_ledger_id,
                       'credits_refunded', v_rr.credits_at_request));

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'token_ledger', v_ledger_id, 'billing.credit_adjustment_recorded',
    jsonb_build_object('refund_request_id', v_rr.id,
                       'amount', v_rr.credits_at_request,
                       'kind', 'refund'));

  RETURN jsonb_build_object('success', true, 'ledger_id', v_ledger_id);
END;
$$;

-- 5.3 decline_refund
CREATE OR REPLACE FUNCTION public.decline_refund(
  p_refund_request_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rr RECORD;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_rr FROM public.refund_requests WHERE id = p_refund_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'REFUND_NOT_FOUND'); END IF;
  IF v_rr.status <> 'pending' THEN RETURN jsonb_build_object('success', false, 'code', 'REFUND_ALREADY_DECIDED'); END IF;

  UPDATE public.refund_requests
    SET status = 'declined', decision_reason = p_reason,
        reviewed_by = p_admin_user_id, reviewed_at = now()
    WHERE id = v_rr.id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_rr.org_id, 'refund_request', v_rr.id, 'billing.refund_declined',
    jsonb_build_object('declined_by', p_admin_user_id, 'reason', p_reason));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5.4 record_payment_dispute
CREATE OR REPLACE FUNCTION public.record_payment_dispute(
  p_org_id UUID,
  p_token_purchase_id UUID,
  p_provider TEXT,
  p_provider_dispute_reference TEXT,
  p_source TEXT,
  p_credits_issued INTEGER,
  p_actor_user_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing UUID;
  v_id UUID;
  v_balance INTEGER;
  v_used INTEGER;
  v_frozen INTEGER;
  v_hold_id UUID;
  v_purchase RECORD;
  v_burn RECORD;
BEGIN
  -- Idempotent on provider_dispute_reference
  SELECT id INTO v_existing FROM public.payment_disputes
    WHERE provider_dispute_reference = p_provider_dispute_reference;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'payment_dispute_id', v_existing, 'idempotent', true);
  END IF;

  SELECT * INTO v_purchase FROM public.token_purchases WHERE id = p_token_purchase_id;
  SELECT COALESCE(balance, 0) INTO v_balance FROM public.token_balances WHERE org_id = p_org_id;

  v_used := GREATEST(0, COALESCE(p_credits_issued, 0) - COALESCE(v_balance, 0));
  v_frozen := LEAST(COALESCE(v_balance, 0), COALESCE(p_credits_issued, 0));

  INSERT INTO public.payment_disputes (
    org_id, token_purchase_id, provider, provider_dispute_reference,
    source, credits_issued, credits_used_at_open, credits_frozen, status, metadata
  ) VALUES (
    p_org_id, p_token_purchase_id, COALESCE(p_provider, 'paystack'),
    p_provider_dispute_reference, p_source, COALESCE(p_credits_issued, 0),
    v_used, v_frozen, 'open', COALESCE(p_metadata, '{}'::jsonb)
  ) RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (p_org_id, 'payment_dispute', v_id, 'billing.payment_dispute_detected',
    jsonb_build_object('provider', p_provider, 'dispute_reference', p_provider_dispute_reference,
                       'source', p_source, 'credits_issued', p_credits_issued,
                       'credits_used_at_open', v_used, 'credits_frozen', v_frozen,
                       'actor_user_id', p_actor_user_id));

  -- Freeze unused via disputed_credit_holds (additive; existing primitive)
  IF v_frozen > 0 AND v_purchase.paystack_reference IS NOT NULL THEN
    INSERT INTO public.disputed_credit_holds (org_id, payment_reference, dispute_reference,
      credits_held, price_usd, status, metadata)
    VALUES (p_org_id, v_purchase.paystack_reference, p_provider_dispute_reference,
      v_frozen, v_purchase.amount_usd, 'open',
      jsonb_build_object('payment_dispute_id', v_id))
    ON CONFLICT (dispute_reference) DO NOTHING
    RETURNING id INTO v_hold_id;

    IF v_hold_id IS NOT NULL THEN
      UPDATE public.payment_disputes SET disputed_credit_hold_id = v_hold_id WHERE id = v_id;
    END IF;

    INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (p_org_id, 'payment_dispute', v_id, 'billing.credits_frozen_due_to_dispute',
      jsonb_build_object('credits_frozen', v_frozen, 'hold_id', v_hold_id));
  END IF;

  -- Mark burned ledger rows for billing review (additive — NEVER delete or mutate)
  IF v_used > 0 THEN
    FOR v_burn IN
      SELECT id FROM public.token_ledger
      WHERE org_id = p_org_id
        AND action_type IN ('declare_intent','poi_generation','api_call','transaction_complete','buyer_commit','counterparty_sighting')
        AND outcome = 'allowed'
        AND created_at >= v_purchase.created_at
      ORDER BY created_at ASC
      LIMIT v_used
    LOOP
      INSERT INTO public.payment_dispute_affected_burns (payment_dispute_id, token_ledger_id)
      VALUES (v_id, v_burn.id)
      ON CONFLICT (payment_dispute_id, token_ledger_id) DO NOTHING;
    END LOOP;

    INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (p_org_id, 'payment_dispute', v_id, 'billing.used_credits_marked_billing_review',
      jsonb_build_object('credits_marked', v_used));
  END IF;

  RETURN jsonb_build_object('success', true, 'payment_dispute_id', v_id,
                            'credits_frozen', v_frozen, 'credits_used', v_used);
END;
$$;

-- 5.5 resolve_payment_dispute_won
CREATE OR REPLACE FUNCTION public.resolve_payment_dispute_won(
  p_payment_dispute_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pd RECORD; v_other_open INTEGER;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_pd FROM public.payment_disputes WHERE id = p_payment_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'DISPUTE_NOT_FOUND'); END IF;
  IF v_pd.status <> 'open' THEN RETURN jsonb_build_object('success', false, 'code', 'DISPUTE_ALREADY_RESOLVED'); END IF;

  UPDATE public.payment_disputes
    SET status = 'won', resolved_by = p_admin_user_id, resolved_at = now(),
        resolution_reason = p_reason
    WHERE id = v_pd.id;

  IF v_pd.disputed_credit_hold_id IS NOT NULL THEN
    UPDATE public.disputed_credit_holds
      SET status = 'won', resolved_at = now(), resolution_reason = p_reason
      WHERE id = v_pd.disputed_credit_hold_id;
  END IF;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_pd.org_id, 'payment_dispute', v_pd.id, 'billing.payment_dispute_resolved_won',
    jsonb_build_object('resolved_by', p_admin_user_id, 'reason', p_reason));

  -- If no other open payment_disputes for the org, auto-release billing hold (if any)
  SELECT COUNT(*) INTO v_other_open FROM public.payment_disputes
    WHERE org_id = v_pd.org_id AND status = 'open' AND id <> v_pd.id;
  IF v_other_open = 0 THEN
    UPDATE public.organizations
      SET billing_hold = false, billing_hold_reason = NULL,
          billing_hold_applied_at = NULL, billing_hold_applied_by = NULL
      WHERE id = v_pd.org_id AND billing_hold = true;
    IF FOUND THEN
      INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
      VALUES (v_pd.org_id, 'organization', v_pd.org_id, 'billing.org_billing_hold_released',
        jsonb_build_object('released_by', p_admin_user_id, 'reason', 'dispute_resolved_won',
                           'payment_dispute_id', v_pd.id));
    END IF;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5.6 resolve_payment_dispute_lost
CREATE OR REPLACE FUNCTION public.resolve_payment_dispute_lost(
  p_payment_dispute_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pd RECORD; v_new_balance INTEGER; v_ledger_id UUID;
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  SELECT * INTO v_pd FROM public.payment_disputes WHERE id = p_payment_dispute_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'DISPUTE_NOT_FOUND'); END IF;
  IF v_pd.status <> 'open' THEN RETURN jsonb_build_object('success', false, 'code', 'DISPUTE_ALREADY_RESOLVED'); END IF;

  -- Append-only administrative adjustment for frozen credits (no row deletion)
  IF v_pd.credits_frozen > 0 THEN
    UPDATE public.token_balances
      SET balance = GREATEST(0, balance - v_pd.credits_frozen)
      WHERE org_id = v_pd.org_id
      RETURNING balance INTO v_new_balance;

    INSERT INTO public.token_ledger (
      org_id, endpoint, tokens_burned, outcome, remaining_balance,
      request_id, action_type, entity_id, metadata
    ) VALUES (
      v_pd.org_id, 'payment_dispute_lost', v_pd.credits_frozen, 'allowed',
      COALESCE(v_new_balance, 0),
      'pd_lost_' || v_pd.id::text,
      'administrative_adjustment', v_pd.id,
      jsonb_build_object('payment_dispute_id', v_pd.id,
                         'reason', p_reason,
                         'resolved_by', p_admin_user_id,
                         'source', 'resolve_payment_dispute_lost')
    ) RETURNING id INTO v_ledger_id;

    INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (v_pd.org_id, 'token_ledger', v_ledger_id, 'billing.credit_adjustment_recorded',
      jsonb_build_object('payment_dispute_id', v_pd.id,
                         'amount', v_pd.credits_frozen,
                         'kind', 'dispute_lost'));
  END IF;

  UPDATE public.payment_disputes
    SET status = 'lost', resolved_by = p_admin_user_id, resolved_at = now(),
        resolution_reason = p_reason
    WHERE id = v_pd.id;

  IF v_pd.disputed_credit_hold_id IS NOT NULL THEN
    UPDATE public.disputed_credit_holds
      SET status = 'lost', resolved_at = now(), resolution_reason = p_reason
      WHERE id = v_pd.disputed_credit_hold_id;
  END IF;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (v_pd.org_id, 'payment_dispute', v_pd.id, 'billing.payment_dispute_resolved_lost',
    jsonb_build_object('resolved_by', p_admin_user_id, 'reason', p_reason,
                       'credits_adjusted', v_pd.credits_frozen));

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5.7 apply_billing_hold
CREATE OR REPLACE FUNCTION public.apply_billing_hold(
  p_org_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  UPDATE public.organizations
    SET billing_hold = true, billing_hold_reason = p_reason,
        billing_hold_applied_at = now(), billing_hold_applied_by = p_admin_user_id
    WHERE id = p_org_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'ORG_NOT_FOUND'); END IF;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (p_org_id, 'organization', p_org_id, 'billing.org_billing_hold_applied',
    jsonb_build_object('applied_by', p_admin_user_id, 'reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5.8 release_billing_hold
CREATE OR REPLACE FUNCTION public.release_billing_hold(
  p_org_id UUID,
  p_admin_user_id UUID,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_reason IS NULL OR char_length(p_reason) < 20 THEN
    RETURN jsonb_build_object('success', false, 'code', 'REASON_REQUIRED');
  END IF;
  UPDATE public.organizations
    SET billing_hold = false, billing_hold_reason = NULL,
        billing_hold_applied_at = NULL, billing_hold_applied_by = NULL
    WHERE id = p_org_id AND billing_hold = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'code', 'BILLING_HOLD_NOT_ACTIVE'); END IF;

  INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
  VALUES (p_org_id, 'organization', p_org_id, 'billing.org_billing_hold_released',
    jsonb_build_object('released_by', p_admin_user_id, 'reason', p_reason));
  RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================
-- 6. Revoke and grant SECDEF — service_role only (SECDEF Stage D1 pattern)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.request_refund(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_refund(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decline_refund(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payment_dispute(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_payment_dispute_won(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_payment_dispute_lost(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_billing_hold(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_billing_hold(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_refund(UUID, UUID, UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_refund(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.decline_refund(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payment_dispute(UUID, UUID, TEXT, TEXT, TEXT, INTEGER, UUID, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_payment_dispute_won(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_payment_dispute_lost(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_billing_hold(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_billing_hold(UUID, UUID, TEXT) TO service_role;

-- ============================================================
-- 7. Rewire atomic_token_burn to respect billing_hold
-- ============================================================
CREATE OR REPLACE FUNCTION public.atomic_token_burn(
  p_org_id uuid, p_amount integer,
  p_reason text DEFAULT 'governance_burn'::text,
  p_reference_id text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $function$
DECLARE
  v_old_balance integer; v_new_balance integer;
  v_correlation_id text; v_match_id_meta jsonb := '{}'::jsonb;
  v_billing_hold boolean;
BEGIN
  -- DEC-007 / PAY-009: refuse burns while org is on billing hold
  SELECT billing_hold INTO v_billing_hold FROM public.organizations WHERE id = p_org_id;
  IF v_billing_hold IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'BILLING_HOLD_ACTIVE',
      'message', 'Organisation is on billing hold; credit burns are blocked until released.');
  END IF;

  UPDATE token_balances SET balance = balance - p_amount
   WHERE org_id = p_org_id AND balance >= p_amount
   RETURNING balance INTO v_new_balance;
  IF NOT FOUND THEN
    SELECT balance INTO v_old_balance FROM token_balances WHERE org_id = p_org_id;
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_TOKENS',
      'current_balance', COALESCE(v_old_balance, 0), 'requested_amount', p_amount);
  END IF;
  v_correlation_id := COALESCE(p_reference_id, gen_random_uuid()::text);
  IF p_reference_id IS NOT NULL AND public._is_uuid(p_reference_id) THEN
    v_match_id_meta := jsonb_build_object('match_id', p_reference_id);
  END IF;
  INSERT INTO token_ledger (org_id, endpoint, tokens_burned, outcome, remaining_balance, request_id, action_type, metadata)
  VALUES (p_org_id, COALESCE(p_reason, 'unknown'), p_amount, 'allowed', v_new_balance, v_correlation_id,
    CASE WHEN p_reason LIKE 'action:%' THEN substring(p_reason from 8)
         WHEN p_reason LIKE 'api:%' THEN 'api_call' ELSE p_reason END,
    jsonb_build_object('source', 'atomic_token_burn', 'correlation_id', v_correlation_id,
      'balance_before', v_new_balance + p_amount, 'balance_after', v_new_balance) || v_match_id_meta);
  RETURN jsonb_build_object('success', true, 'balance_before', v_new_balance + p_amount,
    'balance_after', v_new_balance, 'burned', p_amount, 'reason', p_reason,
    'reference_id', p_reference_id, 'correlation_id', v_correlation_id);
END;
$function$;
