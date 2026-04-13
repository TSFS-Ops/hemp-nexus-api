-- Add a SELECT policy on storage.objects for archived-records bucket
-- Only platform admins (via has_role function) can read archived records
CREATE POLICY "Admins can read archived records"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'archived-records'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);