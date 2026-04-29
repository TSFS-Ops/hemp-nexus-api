-- Counterparty intel must be readable by EITHER party of the match,
-- not just the org that owns the match. The previous policy scoped reads
-- to org_id only, which hid intel from the counterparty side and left
-- the panel stuck on "Running light public-source sketch…" indefinitely.

DROP POLICY IF EXISTS "Org members can view counterparty intel" ON public.match_counterparty_intel;

CREATE POLICY "Match parties can view counterparty intel"
ON public.match_counterparty_intel
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE m.id = match_counterparty_intel.match_id
      AND p.org_id IN (m.org_id, m.buyer_org_id, m.seller_org_id)
  )
);

-- Mirror the same broadened scope for updates so a counterparty-side
-- Refresh click can also persist via RLS-checked paths if ever needed.
DROP POLICY IF EXISTS "Org members can update counterparty intel" ON public.match_counterparty_intel;

CREATE POLICY "Match parties can update counterparty intel"
ON public.match_counterparty_intel
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE m.id = match_counterparty_intel.match_id
      AND p.org_id IN (m.org_id, m.buyer_org_id, m.seller_org_id)
  )
);