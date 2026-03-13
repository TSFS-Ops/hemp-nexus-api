-- Allow authenticated org members to read their own org's audit logs
CREATE POLICY "Org members can view own audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (org_id IN (
  SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
));
