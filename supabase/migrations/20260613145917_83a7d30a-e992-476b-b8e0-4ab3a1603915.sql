
CREATE POLICY "fevd_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'facilitation-evidence'
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id::text = split_part(name, '/', 1)
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.has_role(auth.uid(), 'platform_admin'::app_role)
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);

CREATE POLICY "fevd_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'facilitation-evidence'
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id::text = split_part(name, '/', 1)
      AND (
        fc.requesting_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
        OR public.has_role(auth.uid(), 'platform_admin'::app_role)
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'compliance_analyst'::app_role)
        OR fc.case_owner_id = auth.uid()
      )
  )
);
