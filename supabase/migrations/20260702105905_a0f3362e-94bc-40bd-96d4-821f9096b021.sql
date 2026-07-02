-- Batch M — sealed storage file delete awareness
-- Adds seal-aware helper and rewrites match-documents storage DELETE policy.
-- Does NOT touch other buckets, other operations, or non-storage schemas.

-- Helper: only match-documents bucket; parses final path segment as UUID
-- and delegates to public.is_match_document_sealed. Malformed paths → false.
CREATE OR REPLACE FUNCTION public.is_storage_object_sealed_match_document(
  _bucket_id text,
  _object_name text
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_parts text[];
  v_last text;
  v_doc_id uuid;
BEGIN
  IF _bucket_id IS DISTINCT FROM 'match-documents' THEN
    RETURN false;
  END IF;
  IF _object_name IS NULL OR length(_object_name) = 0 THEN
    RETURN false;
  END IF;

  v_parts := string_to_array(_object_name, '/');
  IF v_parts IS NULL OR array_length(v_parts, 1) IS NULL THEN
    RETURN false;
  END IF;

  v_last := v_parts[array_length(v_parts, 1)];
  IF v_last IS NULL OR length(v_last) = 0 THEN
    RETURN false;
  END IF;

  -- Strip any file extension (defensive; canonical path shape has no ext on doc id)
  IF position('.' IN v_last) > 0 THEN
    v_last := split_part(v_last, '.', 1);
  END IF;

  BEGIN
    v_doc_id := v_last::uuid;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;

  RETURN public.is_match_document_sealed(v_doc_id);
END;
$$;

-- Rewrite ONLY the match-documents DELETE policy to add the seal guard.
DROP POLICY IF EXISTS "Org members can delete own match documents" ON storage.objects;

CREATE POLICY "Org members can delete own match documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'match-documents'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  )
  AND NOT public.is_storage_object_sealed_match_document(bucket_id, name)
);