-- ============================================================
-- 1) Schema additions
-- ============================================================
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS clip_on_always_on boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS clip_on_subscription_started_at timestamptz;

ALTER TABLE public.operator_verification_requests
  ADD COLUMN IF NOT EXISTS clip_on_billed_at timestamptz;

-- One charge per org per calendar month — natural idempotency for the monthly biller.
CREATE TABLE IF NOT EXISTS public.clip_on_subscription_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  price_zar numeric(10,2) NOT NULL,
  credits_burned integer NOT NULL,
  charged_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (org_id, period_month)
);

ALTER TABLE public.clip_on_subscription_charges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins read clip-on charges" ON public.clip_on_subscription_charges;
CREATE POLICY "Platform admins read clip-on charges"
  ON public.clip_on_subscription_charges
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

DROP POLICY IF EXISTS "Platform admins write clip-on charges" ON public.clip_on_subscription_charges;
CREATE POLICY "Platform admins write clip-on charges"
  ON public.clip_on_subscription_charges
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- ============================================================
-- 2) Per-request billing function + trigger
-- ============================================================
CREATE OR REPLACE FUNCTION public.bill_clip_on_request(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    INSERT INTO public.audit_logs (
      org_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
      v_req.org_id, NULL, 'clip_on.request_charge_failed',
      'operator_verification_request', p_request_id,
      jsonb_build_object(
        'priced_total_zar', v_total,
        'credits_required', v_credits,
        'reason', v_burn
      )
    );
    RETURN jsonb_build_object('success', false, 'error', 'INSUFFICIENT_CREDITS', 'detail', v_burn);
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
$$;

REVOKE ALL ON FUNCTION public.bill_clip_on_request(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_clip_on_bill_on_pickup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'in_progress' AND COALESCE(OLD.status, '') <> 'in_progress' THEN
    PERFORM public.bill_clip_on_request(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clip_on_bill_on_pickup ON public.operator_verification_requests;
CREATE TRIGGER clip_on_bill_on_pickup
AFTER UPDATE OF status ON public.operator_verification_requests
FOR EACH ROW
EXECUTE FUNCTION public.tg_clip_on_bill_on_pickup();

-- ============================================================
-- 3) Monthly subscription biller
-- ============================================================
CREATE OR REPLACE FUNCTION public.bill_clip_on_subscriptions_monthly()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pricing jsonb;
  v_monthly_zar numeric;
  v_margin_pct numeric;
  v_total_zar numeric;
  v_credits integer;
  v_period date;
  v_org RECORD;
  v_burn jsonb;
  v_billed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
BEGIN
  SELECT value INTO v_pricing
  FROM public.admin_settings
  WHERE key = 'operator_verification_clip_on_pricing';

  v_monthly_zar := COALESCE((v_pricing->>'permanent_integration_monthly_zar')::numeric, 2500);
  v_margin_pct := COALESCE((v_pricing->>'permanent_integration_margin_pct')::numeric, 80);
  v_total_zar := v_monthly_zar * (1 + v_margin_pct / 100.0);
  v_credits := GREATEST(1, CEIL(v_total_zar / 10.0)::integer);
  v_period := date_trunc('month', now())::date;

  FOR v_org IN
    SELECT id FROM public.organizations
    WHERE clip_on_always_on = true
      AND status = 'active'
      AND frozen = false
  LOOP
    BEGIN
      INSERT INTO public.clip_on_subscription_charges
        (org_id, period_month, price_zar, credits_burned, metadata)
      VALUES
        (v_org.id, v_period, v_total_zar, v_credits,
         jsonb_build_object('cost_zar', v_monthly_zar, 'margin_pct', v_margin_pct));
    EXCEPTION WHEN unique_violation THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END;

    v_burn := public.atomic_token_burn(
      v_org.id,
      v_credits,
      'clip_on.subscription_monthly',
      v_org.id::text || ':' || to_char(v_period, 'YYYY-MM')
    );

    IF NOT (v_burn->>'success')::boolean THEN
      -- Roll back the row we just inserted so a retry can pick this org up.
      DELETE FROM public.clip_on_subscription_charges
       WHERE org_id = v_org.id AND period_month = v_period;
      v_failed := v_failed + 1;
      INSERT INTO public.audit_logs (org_id, action, entity_type, entity_id, metadata)
      VALUES (
        v_org.id, 'clip_on.subscription_charge_failed',
        'organization', v_org.id,
        jsonb_build_object('credits_required', v_credits, 'reason', v_burn)
      );
      CONTINUE;
    END IF;

    INSERT INTO public.audit_logs (org_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_org.id, 'clip_on.subscription_charged',
      'organization', v_org.id,
      jsonb_build_object(
        'price_zar', v_total_zar,
        'credits_burned', v_credits,
        'period_month', to_char(v_period, 'YYYY-MM')
      )
    );
    v_billed := v_billed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'billed', v_billed,
    'skipped_already_billed_this_month', v_skipped,
    'failed_insufficient_credits', v_failed,
    'period_month', to_char(v_period, 'YYYY-MM')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.bill_clip_on_subscriptions_monthly() FROM PUBLIC, anon, authenticated;