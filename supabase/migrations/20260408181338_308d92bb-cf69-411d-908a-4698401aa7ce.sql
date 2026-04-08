
-- =============================================
-- TASK 1: Patch counterparties IDOR vulnerability
-- =============================================

-- Drop the permissive "any authenticated user can read" policy
DROP POLICY IF EXISTS "Authenticated users can read counterparties" ON public.counterparties;
DROP POLICY IF EXISTS "Users can view counterparties" ON public.counterparties;

-- Create org-scoped SELECT policy
CREATE POLICY "Users can only read own org counterparties"
ON public.counterparties
FOR SELECT
TO authenticated
USING (
  org_id = (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
);

-- =============================================
-- TASK 2: Lock down storage buckets
-- =============================================

-- 2a. Remove the overly permissive match-documents INSERT policy
DROP POLICY IF EXISTS "Upload match documents" ON storage.objects;

-- 2b. match-documents: UPDATE policy (org-scoped + admin)
CREATE POLICY "Org members can update own match documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'match-documents'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  )
);

-- 2c. match-documents: DELETE policy (org-scoped + admin)
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
);

-- 2d. kyc-documents: UPDATE policy (org-scoped + admin)
CREATE POLICY "Org members can update own kyc documents"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'kyc-documents'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  )
);

-- 2e. kyc-documents: DELETE policy (org-scoped + admin)
CREATE POLICY "Org members can delete own kyc documents"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'kyc-documents'
  AND (
    (storage.foldername(name))[1] IN (
      SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
    )
    OR public.has_role(auth.uid(), 'platform_admin'::public.app_role)
  )
);
