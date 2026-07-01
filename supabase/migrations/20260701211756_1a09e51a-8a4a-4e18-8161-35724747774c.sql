-- Roll back Batch J1: the trigger installed moments ago would block a
-- legitimate refund settlement path (credit -> credit_refund promotion
-- in supabase/functions/token-purchase/index.ts around line 2076) that
-- was not covered by the prior B2 inspection. Removing the trigger and
-- function pending a broader allowlist inspection.
DROP TRIGGER IF EXISTS token_ledger_append_only_trg ON public.token_ledger;
DROP FUNCTION IF EXISTS public.assert_token_ledger_append_only();