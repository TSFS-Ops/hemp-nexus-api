
-- 1) facilitation_cases: tighten compliance_analyst SELECT to escalated cases only
DROP POLICY IF EXISTS "fc_select_admin" ON public.facilitation_cases;

CREATE POLICY "fc_select_admin"
  ON public.facilitation_cases FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR (case_owner_id = auth.uid())
    OR (
      public.has_role(auth.uid(),'compliance_analyst'::app_role)
      AND (
        internal_status IN ('compliance_review_required','blocked_by_compliance')
        OR EXISTS (
          SELECT 1 FROM public.facilitation_compliance_escalations e
          WHERE e.facilitation_case_id = facilitation_cases.id
        )
      )
    )
  );

-- 2) org_directors: split ALL into SELECT (org members) and write (admins only)
DROP POLICY IF EXISTS "Users manage own org directors" ON public.org_directors;

CREATE POLICY "Org members can read own org directors"
  ON public.org_directors FOR SELECT
  TO authenticated
  USING (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE POLICY "Org admins can insert own org directors"
  ON public.org_directors FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (
      public.has_role(auth.uid(),'org_admin'::app_role)
      OR public.has_role(auth.uid(),'platform_admin'::app_role)
    )
  );

CREATE POLICY "Org admins can update own org directors"
  ON public.org_directors FOR UPDATE
  TO authenticated
  USING (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (
      public.has_role(auth.uid(),'org_admin'::app_role)
      OR public.has_role(auth.uid(),'platform_admin'::app_role)
    )
  )
  WITH CHECK (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (
      public.has_role(auth.uid(),'org_admin'::app_role)
      OR public.has_role(auth.uid(),'platform_admin'::app_role)
    )
  );

CREATE POLICY "Org admins can delete own org directors"
  ON public.org_directors FOR DELETE
  TO authenticated
  USING (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (
      public.has_role(auth.uid(),'org_admin'::app_role)
      OR public.has_role(auth.uid(),'platform_admin'::app_role)
    )
  );

-- 3) storage.objects match-documents SELECT: remove md.org_id fallback
DROP POLICY IF EXISTS "View match documents based on visibility" ON storage.objects;

CREATE POLICY "View match documents based on visibility"
  ON storage.objects FOR SELECT
  TO public
  USING (
    bucket_id = 'match-documents'
    AND EXISTS (
      SELECT 1 FROM public.match_documents md
      WHERE md.storage_path = objects.name
        AND (
          -- uploader's org always sees its own uploads
          md.uploader_org_id IN (
            SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
          )
          -- explicit share-with-counterparty
          OR (
            md.visibility = 'share_with_counterparty'
            AND md.status <> ALL (ARRAY['revoked','archived'])
            AND md.match_id IN (
              SELECT m.id FROM public.matches m
              WHERE m.buyer_org_id  IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
                 OR m.seller_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
            )
          )
          -- explicit share-with-roles via document_access grants
          OR (
            md.visibility = 'share_with_roles'
            AND md.status <> ALL (ARRAY['revoked','archived'])
            AND md.id IN (
              SELECT da.document_id FROM public.document_access da
              WHERE da.revoked_at IS NULL
                AND (
                  da.granted_to_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
                  OR da.granted_to_user_id = auth.uid()
                )
            )
          )
          OR public.has_role(auth.uid(),'platform_admin'::app_role)
        )
    )
  );

-- 4) staging_password_tokens: drop plaintext column entirely
ALTER TABLE public.staging_password_tokens
  DROP COLUMN IF EXISTS password_plaintext;
