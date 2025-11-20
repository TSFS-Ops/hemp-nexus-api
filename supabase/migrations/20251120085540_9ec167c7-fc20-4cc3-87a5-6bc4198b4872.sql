-- Drop existing policies that allow org-wide access
DROP POLICY IF EXISTS "Authenticated users can view own org API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Authenticated users can update own org API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Authenticated users can delete own org API keys" ON public.api_keys;

-- Create new policies that restrict to user's own API keys
CREATE POLICY "Users can view their own API keys"
ON public.api_keys
FOR SELECT
TO authenticated
USING (
  created_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Users can update their own API keys"
ON public.api_keys
FOR UPDATE
TO authenticated
USING (created_by = auth.uid())
WITH CHECK (created_by = auth.uid());

CREATE POLICY "Users can delete their own API keys"
ON public.api_keys
FOR DELETE
TO authenticated
USING (created_by = auth.uid());

-- Keep the insert policy but ensure created_by is set correctly
DROP POLICY IF EXISTS "Authenticated users can create API keys" ON public.api_keys;

CREATE POLICY "Users can create their own API keys"
ON public.api_keys
FOR INSERT
TO authenticated
WITH CHECK (
  org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
  AND created_by = auth.uid()
);