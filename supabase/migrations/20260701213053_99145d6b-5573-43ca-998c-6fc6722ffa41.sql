-- Batch J2: Sealed match_document full-freeze trigger (tracker item #9)
-- Once a match_documents row is referenced inside a sealed, non-revoked WaD
-- evidence bundle, the row is frozen: no UPDATE, no DELETE. New evidence
-- must go through a new document version + new/superseding WaD.

CREATE OR REPLACE FUNCTION public.is_match_document_sealed(_doc_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.wads w,
         LATERAL jsonb_array_elements(COALESCE(w.evidence_bundle->'documents', '[]'::jsonb)) AS doc
    WHERE w.sealed_at IS NOT NULL
      AND w.revoked_at IS NULL
      AND (doc->>'id')::uuid = _doc_id
  );
$$;

CREATE OR REPLACE FUNCTION public.assert_match_document_sealed_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _doc_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _doc_id := OLD.id;
  ELSE
    _doc_id := OLD.id;
  END IF;

  IF public.is_match_document_sealed(_doc_id) THEN
    RAISE EXCEPTION
      'sealed_match_document_immutable: match_documents row % is referenced by a sealed, non-revoked WaD evidence bundle and cannot be modified or deleted. Create a new document version and a new/superseding WaD.', _doc_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_documents_sealed_immutability_trg ON public.match_documents;
CREATE TRIGGER match_documents_sealed_immutability_trg
  BEFORE UPDATE OR DELETE ON public.match_documents
  FOR EACH ROW EXECUTE FUNCTION public.assert_match_document_sealed_immutability();

COMMENT ON FUNCTION public.is_match_document_sealed(uuid) IS
  'Batch J2 / tracker #9: returns true if the document id is referenced by any sealed (sealed_at IS NOT NULL) and non-revoked (revoked_at IS NULL) WaD evidence_bundle->documents[*].id.';
COMMENT ON FUNCTION public.assert_match_document_sealed_immutability() IS
  'Batch J2 / tracker #9: BEFORE UPDATE/DELETE guard on public.match_documents. Blocks with sealed_match_document_immutable when row is referenced by a sealed, non-revoked WaD.';
