
-- Recreate facilitation_cases admin select policy using canonical is_admin()
DROP POLICY IF EXISTS "fc_select_admin" ON public.facilitation_cases;
CREATE POLICY "fc_select_admin" ON public.facilitation_cases
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
  OR case_owner_id = auth.uid()
);

-- Recreate facilitation_case_evidence policies
DROP POLICY IF EXISTS "fce_select_org_or_admin" ON public.facilitation_case_evidence;
CREATE POLICY "fce_select_org_or_admin" ON public.facilitation_case_evidence
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = case_id
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.is_admin(auth.uid())
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS "fce_insert_uploader" ON public.facilitation_case_evidence;
CREATE POLICY "fce_insert_uploader" ON public.facilitation_case_evidence
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = case_id
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.is_admin(auth.uid())
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);

-- Recreate facilitation_case_events select policy
DROP POLICY IF EXISTS "fcev_select_admin" ON public.facilitation_case_events;
CREATE POLICY "fcev_select_admin" ON public.facilitation_case_events
FOR SELECT TO authenticated
USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = case_id AND fc.case_owner_id = auth.uid()
  )
);

-- Recreate facilitation-evidence storage policies
DROP POLICY IF EXISTS "fevd_select" ON storage.objects;
CREATE POLICY "fevd_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'facilitation-evidence'
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id::text = split_part(name, '/', 1)
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.is_admin(auth.uid())
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);

DROP POLICY IF EXISTS "fevd_insert" ON storage.objects;
CREATE POLICY "fevd_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'facilitation-evidence'
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id::text = split_part(name, '/', 1)
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.is_admin(auth.uid())
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);
