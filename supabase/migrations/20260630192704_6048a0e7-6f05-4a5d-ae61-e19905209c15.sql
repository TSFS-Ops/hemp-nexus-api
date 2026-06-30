-- Defence-in-depth: explicitly deny anon/authenticated DELETE and UPDATE on
-- objects in the facilitation-evidence storage bucket. Lifecycle/cleanup
-- happens via service-role workers; clients must never mutate or remove
-- evidence files. Restrictive policies AND with all permissive policies,
-- so any future permissive policy mistake remains blocked for these roles.

CREATE POLICY "fevd_delete_block_clients"
ON storage.objects
AS RESTRICTIVE
FOR DELETE
TO anon, authenticated
USING (bucket_id <> 'facilitation-evidence');

CREATE POLICY "fevd_update_block_clients"
ON storage.objects
AS RESTRICTIVE
FOR UPDATE
TO anon, authenticated
USING (bucket_id <> 'facilitation-evidence');