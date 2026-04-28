-- Fix the SECURITY DEFINER view finding for the reconciliation view I
-- just introduced. Views should run as the querying user so RLS on
-- base tables is honoured.
ALTER VIEW public.v_clip_on_reconciliation SET (security_invoker = true);

-- Lock down EXECUTE on the billing helpers I introduced. They are
-- intended to be called by the trigger (SECURITY DEFINER context) and
-- by admin/edge code with service-role, never by anon/authenticated
-- users directly.
REVOKE ALL ON FUNCTION public.bill_clip_on_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_clip_on_billing_failure(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_clip_on_block_unbilled_revert() FROM PUBLIC, anon, authenticated;

-- Restrict the reconciliation view to admins. Base-table RLS already
-- limits visibility, but make intent explicit.
REVOKE ALL ON public.v_clip_on_reconciliation FROM PUBLIC, anon;
GRANT SELECT ON public.v_clip_on_reconciliation TO authenticated;