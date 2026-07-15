-- Support attachments — storage.objects policies.
-- Path convention: <ticket_id>/<uuid>-<filename>
DROP POLICY IF EXISTS "support_att_upload" ON storage.objects;
CREATE POLICY "support_att_upload" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'support-attachments' AND owner = auth.uid());

DROP POLICY IF EXISTS "support_att_read" ON storage.objects;
CREATE POLICY "support_att_read" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments' AND (
      owner = auth.uid()
      OR public.has_role(auth.uid(),'platform_admin')
      OR public.has_support_capability(auth.uid(),'support_read')
      OR EXISTS (
        SELECT 1 FROM public.support_ticket_attachments a
        JOIN public.support_tickets t ON t.id = a.ticket_id
        WHERE a.storage_path = storage.objects.name
          AND (t.created_by = auth.uid() OR t.on_behalf_of_user_id = auth.uid())
          AND NOT a.is_internal_only
      )
    )
  );

DROP POLICY IF EXISTS "support_att_delete_admin" ON storage.objects;
CREATE POLICY "support_att_delete_admin" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'support-attachments' AND public.has_role(auth.uid(),'platform_admin'));