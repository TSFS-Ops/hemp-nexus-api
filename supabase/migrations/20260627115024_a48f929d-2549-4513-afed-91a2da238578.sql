-- PayFast Phase 2A — provider identity hardening on token_purchases.
--
-- Adds an explicit, provider-agnostic identity pair (provider,
-- provider_reference) to token_purchases without changing any existing
-- Paystack behaviour. The historical column `paystack_reference` and
-- its UNIQUE constraint are intentionally preserved.

-- 1. Add the new columns. Nullable on purpose: legacy rows that pre-date
--    this migration may have neither a paystack_reference nor a usable
--    metadata.provider value (e.g. very old free-credit rows). Forcing
--    NOT NULL here would make the migration unsafe.
ALTER TABLE public.token_purchases
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_reference TEXT;

-- 2. Backfill provider_reference from the historical paystack_reference
--    column first, then fall back to metadata.provider_reference for any
--    row that somehow has the metadata key but not the column.
UPDATE public.token_purchases
   SET provider_reference = paystack_reference
 WHERE provider_reference IS NULL
   AND paystack_reference IS NOT NULL;

UPDATE public.token_purchases
   SET provider_reference = metadata->>'provider_reference'
 WHERE provider_reference IS NULL
   AND metadata ? 'provider_reference'
   AND length(coalesce(metadata->>'provider_reference', '')) > 0;

-- 3. Backfill provider. Prefer an explicit metadata.provider when it is
--    one of the recognised ids; otherwise default to 'paystack' for any
--    row that carries a paystack_reference (which, by construction, is
--    a Paystack row — PayFast is not yet live).
UPDATE public.token_purchases
   SET provider = metadata->>'provider'
 WHERE provider IS NULL
   AND metadata ? 'provider'
   AND metadata->>'provider' IN ('paystack', 'payfast');

UPDATE public.token_purchases
   SET provider = 'paystack'
 WHERE provider IS NULL
   AND paystack_reference IS NOT NULL;

-- 4. Constrain provider to the known ids so a typo cannot land a row
--    under an unknown provider. NULL remains allowed for legacy rows.
ALTER TABLE public.token_purchases
  DROP CONSTRAINT IF EXISTS token_purchases_provider_known_chk;
ALTER TABLE public.token_purchases
  ADD CONSTRAINT token_purchases_provider_known_chk
  CHECK (provider IS NULL OR provider IN ('paystack', 'payfast'));

-- 5. Partial unique index on (provider, provider_reference). This is the
--    forward-compatible duplicate-credit guard for PayFast and any
--    future provider. It is partial so legacy rows where either column
--    is NULL are not implicated, and so the existing UNIQUE on
--    paystack_reference is not weakened.
CREATE UNIQUE INDEX IF NOT EXISTS token_purchases_provider_reference_uidx
  ON public.token_purchases (provider, provider_reference)
  WHERE provider IS NOT NULL AND provider_reference IS NOT NULL;

-- 6. Helpful secondary index for admin / reconciliation lookups by
--    provider reference alone (no uniqueness — historical Paystack rows
--    will all share provider='paystack').
CREATE INDEX IF NOT EXISTS idx_token_purchases_provider
  ON public.token_purchases (provider);

COMMENT ON COLUMN public.token_purchases.provider IS
  'Payment provider id (paystack | payfast). Nullable for legacy rows. PayFast Phase 2A.';
COMMENT ON COLUMN public.token_purchases.provider_reference IS
  'Provider-native opaque reference. For Paystack rows this mirrors paystack_reference; for future PayFast rows this carries m_payment_id / pf_payment_id. PayFast Phase 2A.';
