CREATE OR REPLACE FUNCTION public.can_delete_match_document_object(_user_id uuid, _object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'platform_admin')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.matches m ON m.id::text = split_part(_object_name, '/', 2)
      WHERE p.id = _user_id
        AND split_part(_object_name, '/', 1) = p.org_id::text
        AND (
          m.org_id = p.org_id
          OR m.buyer_org_id = p.org_id
          OR m.seller_org_id = p.org_id
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_delete_match_document_object(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_delete_match_document_object(uuid, text) TO authenticated;

DROP POLICY IF EXISTS "Participants can delete own match upload objects" ON storage.objects;

CREATE POLICY "Participants can delete own match upload objects"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'match-documents'
  AND public.can_delete_match_document_object(auth.uid(), name)
);