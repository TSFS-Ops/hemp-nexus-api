CREATE POLICY "Org members can view their own API request logs"
ON public.api_request_logs
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()
  )
);