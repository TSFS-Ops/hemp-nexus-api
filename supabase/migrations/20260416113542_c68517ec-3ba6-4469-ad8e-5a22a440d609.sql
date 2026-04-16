-- Fix: Allow counterparties (buyer_org_id / seller_org_id) to update matches they participate in
DROP POLICY IF EXISTS "Users can update their org's matches" ON public.matches;

CREATE POLICY "Users can update matches they participate in"
ON public.matches
FOR UPDATE
USING (
  org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  OR buyer_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  OR seller_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
);