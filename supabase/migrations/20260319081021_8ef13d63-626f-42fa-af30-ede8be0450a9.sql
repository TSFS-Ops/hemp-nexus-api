CREATE POLICY "Org members can update their own org"
ON public.organizations
FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  )
)
WITH CHECK (
  id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  )
);