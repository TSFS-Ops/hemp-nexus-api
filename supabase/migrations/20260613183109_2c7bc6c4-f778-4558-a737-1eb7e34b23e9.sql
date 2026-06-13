-- Corrective fix: break recursive RLS chain between match_documents <-> document_access
-- which causes "infinite recursion detected in policy for relation document_access"
-- on any authenticated storage.objects INSERT/SELECT (planner evaluates all storage policies).
--
-- Same access boundary preserved. No widening of document visibility, no change to
-- ownership/upload rules, no change to POI/WaD/match/token/credit/payment/notification/
-- email/facilitation case behaviour. SECURITY DEFINER terminates the policy cycle.

CREATE OR REPLACE FUNCTION public.match_document_visible(_user uuid, _document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_documents md
    WHERE md.id = _document_id
      AND (
        md.uploader_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
        OR md.id IN (
          SELECT da.document_id
          FROM public.document_access da
          WHERE (da.granted_to_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user))
             OR da.granted_to_user_id = _user
        )
        OR public.is_admin(_user)
      )
  );
$$;

REVOKE ALL ON FUNCTION public.match_document_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_document_visible(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.document_access_visible(_user uuid, _document_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.match_documents md
    WHERE md.id = _document_id
      AND md.uploader_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
  )
  OR EXISTS (
    SELECT 1
    FROM public.document_access da
    WHERE da.document_id = _document_id
      AND (
        da.granted_to_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = _user)
        OR da.granted_to_user_id = _user
      )
  )
  OR public.is_admin(_user);
$$;

REVOKE ALL ON FUNCTION public.document_access_visible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_access_visible(uuid, uuid) TO authenticated, service_role;

-- Rewrite the two recursive policies to call the SECURITY DEFINER helpers.
-- Same access boundary, no widening.

DROP POLICY IF EXISTS "Document visibility based on ownership and sharing" ON public.match_documents;
CREATE POLICY "Document visibility based on ownership and sharing"
ON public.match_documents
FOR SELECT
USING (public.match_document_visible(auth.uid(), id));

DROP POLICY IF EXISTS "Users can view access grants for their documents" ON public.document_access;
CREATE POLICY "Users can view access grants for their documents"
ON public.document_access
FOR SELECT
USING (public.document_access_visible(auth.uid(), document_id));

COMMENT ON FUNCTION public.match_document_visible(uuid, uuid) IS
  'Corrective RLS helper: terminates recursion between match_documents and document_access policies. Same access boundary as the original inline subqueries.';
COMMENT ON FUNCTION public.document_access_visible(uuid, uuid) IS
  'Corrective RLS helper: terminates recursion between document_access and match_documents policies. Same access boundary as the original inline subqueries.';