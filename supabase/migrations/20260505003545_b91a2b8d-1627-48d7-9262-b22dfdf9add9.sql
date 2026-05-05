DROP POLICY IF EXISTS "Org members can delete own match documents" ON storage.objects;

CREATE POLICY "Participants can delete own match upload objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'match-documents'
  AND (
    public.has_role(auth.uid(), 'platform_admin')
    OR (
      (storage.foldername(name))[1] IN (
        SELECT p.org_id::text
        FROM public.profiles p
        WHERE p.id = auth.uid()
      )
      AND EXISTS (
        SELECT 1
        FROM public.matches m
        JOIN public.profiles p2 ON p2.id = auth.uid()
        WHERE m.id::text = (storage.foldername(storage.objects.name))[2]
          AND (
            m.org_id = p2.org_id
            OR m.buyer_org_id = p2.org_id
            OR m.seller_org_id = p2.org_id
          )
      )
    )
  )
);