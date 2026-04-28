CREATE POLICY "Match participants can raise verification requests"
ON public.operator_verification_requests
FOR INSERT
TO authenticated
WITH CHECK (
  raised_by = auth.uid()
  AND status = 'pending'
  AND outcome IS NULL
  AND reviewer_notes IS NULL
  AND assigned_to IS NULL
  AND org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
  AND match_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = operator_verification_requests.match_id
      AND (
        m.org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR m.buyer_id IN (SELECT org_id::text FROM public.profiles WHERE id = auth.uid())
        OR m.seller_id IN (SELECT org_id::text FROM public.profiles WHERE id = auth.uid())
      )
  )
);

CREATE POLICY "Match participants can view their own raised requests"
ON public.operator_verification_requests
FOR SELECT
TO authenticated
USING (
  raised_by = auth.uid()
  AND org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
);