DROP POLICY "Org members can update their own org" ON public.organizations;

CREATE POLICY "Org admins can update their own org"
ON public.organizations
FOR UPDATE
TO authenticated
USING (
  id IN (
    SELECT p.org_id FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND ur.role IN ('org_admin', 'platform_admin', 'admin')
  )
)
WITH CHECK (
  id IN (
    SELECT p.org_id FROM profiles p
    JOIN user_roles ur ON ur.user_id = p.id
    WHERE p.id = auth.uid()
      AND ur.role IN ('org_admin', 'platform_admin', 'admin')
  )
);