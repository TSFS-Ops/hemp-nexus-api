
DROP POLICY IF EXISTS "export_buckets_deny_authenticated_select" ON storage.objects;
DROP POLICY IF EXISTS "export_buckets_deny_authenticated_insert" ON storage.objects;
DROP POLICY IF EXISTS "export_buckets_deny_authenticated_update" ON storage.objects;
DROP POLICY IF EXISTS "export_buckets_deny_authenticated_delete" ON storage.objects;

CREATE POLICY "export_buckets_restrict_authenticated_select"
ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
USING (
  bucket_id <> ALL (ARRAY['user-exports'::text, 'admin-exports'::text])
  OR (bucket_id = 'user-exports' AND (auth.uid())::text = (storage.foldername(name))[1])
  OR (bucket_id = 'admin-exports' AND is_admin(auth.uid()))
);

CREATE POLICY "export_buckets_restrict_authenticated_insert"
ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (bucket_id <> ALL (ARRAY['user-exports'::text, 'admin-exports'::text]));

CREATE POLICY "export_buckets_restrict_authenticated_update"
ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
USING (bucket_id <> ALL (ARRAY['user-exports'::text, 'admin-exports'::text]))
WITH CHECK (bucket_id <> ALL (ARRAY['user-exports'::text, 'admin-exports'::text]));

CREATE POLICY "export_buckets_restrict_authenticated_delete"
ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
USING (bucket_id <> ALL (ARRAY['user-exports'::text, 'admin-exports'::text]));
