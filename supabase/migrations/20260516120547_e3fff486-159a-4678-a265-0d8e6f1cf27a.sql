
-- ============================================================
-- Batch C — Fix 1: audit-row dedupe for credits.purchased
-- ============================================================
-- Prevent duplicate audit rows when the Paystack webhook and the
-- verify-fallback callback both fire for the same payment reference.
-- token_ledger already has a UNIQUE(request_id) guard that prevents
-- double-credit; this index gives the same protection to the audit trail.
--
-- Pre-check: zero duplicate rows currently exist (verified before migration).
-- New duplicate inserts now raise 23505, which call sites already tolerate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_logs_credits_purchased_ref
  ON public.audit_logs ((metadata->>'payment_reference'))
  WHERE action = 'credits.purchased'
    AND metadata->>'payment_reference' IS NOT NULL;

-- ============================================================
-- Batch C — Fix 3: token_purchases pending-row table
-- ============================================================
-- The transaction-reconciliation cron scans token_purchases rows with
-- status='pending' older than 30 minutes. The table did not exist yet,
-- so the safety-net was effectively dead code. Create it now so every
-- initiated checkout writes a pending row that the cron can sweep.
CREATE TABLE IF NOT EXISTS public.token_purchases (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  paystack_reference  text NOT NULL UNIQUE,
  package_id          text NOT NULL,
  token_amount        integer NOT NULL,
  amount_usd          numeric(12,2) NOT NULL,
  currency            text NOT NULL DEFAULT 'USD',
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','completed','failed','abandoned')),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_token_purchases_status_created
  ON public.token_purchases (status, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_token_purchases_org
  ON public.token_purchases (org_id, created_at DESC);

-- updated_at trigger using existing helper.
DROP TRIGGER IF EXISTS trg_token_purchases_updated_at ON public.token_purchases;
CREATE TRIGGER trg_token_purchases_updated_at
  BEFORE UPDATE ON public.token_purchases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Strict RLS: service_role only. Edge functions use the service-role
-- client; nothing user-facing reads this table directly. Org members
-- view payment status via token_ledger + audit_logs as before.
ALTER TABLE public.token_purchases ENABLE ROW LEVEL SECURITY;

-- No SELECT/INSERT/UPDATE/DELETE policies for authenticated/anon ⇒
-- RLS denies all client traffic. service_role bypasses RLS.

REVOKE ALL ON public.token_purchases FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.token_purchases TO service_role;
