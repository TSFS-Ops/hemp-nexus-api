-- ============================================================
-- acceptance_receipts: explicit restrictive deny for client writes
-- RLS already enabled; only SELECT policy exists. Add restrictive
-- policies so that authenticated/anon cannot INSERT/UPDATE/DELETE
-- under any circumstances. service_role bypasses RLS.
-- ============================================================
DROP POLICY IF EXISTS "Deny client inserts on acceptance_receipts" ON public.acceptance_receipts;
CREATE POLICY "Deny client inserts on acceptance_receipts"
  ON public.acceptance_receipts
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated, anon
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny client updates on acceptance_receipts" ON public.acceptance_receipts;
CREATE POLICY "Deny client updates on acceptance_receipts"
  ON public.acceptance_receipts
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated, anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny client deletes on acceptance_receipts" ON public.acceptance_receipts;
CREATE POLICY "Deny client deletes on acceptance_receipts"
  ON public.acceptance_receipts
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated, anon
  USING (false);

-- ============================================================
-- webhook_endpoints: column-level REVOKE for signing secrets
-- RLS SELECT policy already restricts rows to admins, but we also
-- remove the column-level SELECT/UPDATE grant for secret_hash and
-- previous_secret_hash from authenticated + anon as defence-in-depth.
-- service_role retains full access for rotation flows.
-- ============================================================
REVOKE SELECT (secret_hash, previous_secret_hash)
  ON public.webhook_endpoints FROM authenticated, anon;

REVOKE UPDATE (secret_hash, previous_secret_hash)
  ON public.webhook_endpoints FROM authenticated, anon;

REVOKE INSERT (secret_hash, previous_secret_hash)
  ON public.webhook_endpoints FROM authenticated, anon;
