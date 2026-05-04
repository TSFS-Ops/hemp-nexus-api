-- =====================================================================
-- PAY-009: Chargeback / dispute handling for credit purchases
-- =====================================================================

CREATE TABLE public.disputed_credit_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  payment_reference text NOT NULL,
  dispute_reference text NOT NULL UNIQUE,
  credits_held integer NOT NULL CHECK (credits_held > 0),
  price_usd numeric(12,2),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','reminded','won','lost','merchant_accepted')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  reminded_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  admin_risk_item_id uuid REFERENCES public.admin_risk_items(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_disputed_credit_holds_org_open
  ON public.disputed_credit_holds (org_id) WHERE status IN ('open','reminded');
CREATE INDEX idx_disputed_credit_holds_payment_ref
  ON public.disputed_credit_holds (payment_reference);

ALTER TABLE public.disputed_credit_holds ENABLE ROW LEVEL SECURITY;

-- Members of an org (= profiles.org_id matches) can read their own org's holds.
CREATE POLICY "Org members can read their own holds"
  ON public.disputed_credit_holds
  FOR SELECT
  TO authenticated
  USING (
    org_id IN (
      SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid() AND p.org_id IS NOT NULL
    )
  );

-- Platform admins can read every hold.
CREATE POLICY "Platform admins can read all holds"
  ON public.disputed_credit_holds
  FOR SELECT
  TO authenticated
  USING (public.is_admin(auth.uid()));

CREATE TRIGGER update_disputed_credit_holds_updated_at
  BEFORE UPDATE ON public.disputed_credit_holds
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- Usable-balance view: balance, held, usable
-- =====================================================================
CREATE OR REPLACE VIEW public.org_token_balances_v AS
SELECT
  tb.org_id,
  tb.balance,
  COALESCE(SUM(h.credits_held) FILTER (
    WHERE h.status IN ('open','reminded')
  ), 0)::int AS held,
  GREATEST(
    tb.balance - COALESCE(SUM(h.credits_held) FILTER (
      WHERE h.status IN ('open','reminded')
    ), 0),
    0
  )::int AS usable
FROM public.token_balances tb
LEFT JOIN public.disputed_credit_holds h ON h.org_id = tb.org_id
GROUP BY tb.org_id, tb.balance;

GRANT SELECT ON public.org_token_balances_v TO authenticated;
