-- Add positive SELECT policy for webhook_endpoints so org members can read
-- back their own webhook configurations (URLs + secret hashes).
-- The existing admin-only SELECT policy remains in place and stacks
-- permissively with this one. Org-scoped access is the secure default
-- (RLS continues to block cross-org reads).
CREATE POLICY "Users can select their org webhooks"
  ON public.webhook_endpoints
  FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT profiles.org_id FROM public.profiles WHERE profiles.id = auth.uid()));

-- Positive SELECT policy for the `user-exports` storage bucket.
-- Files are laid out under `{auth.uid()}/...`, so we scope downloads to
-- objects whose first path segment matches the requesting user. This
-- coexists with the existing negative deny policy (PERMISSIVE policies
-- are OR-combined; an authenticated user matching this rule is allowed,
-- while anonymous and other-user requests remain blocked).
CREATE POLICY "Users can download their own user-exports"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'user-exports'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Positive SELECT policy for the `admin-exports` storage bucket — only
-- platform admins may download. Relies on the canonical is_admin() helper.
CREATE POLICY "Platform admins can download admin-exports"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'admin-exports'
    AND public.is_admin(auth.uid())
  );