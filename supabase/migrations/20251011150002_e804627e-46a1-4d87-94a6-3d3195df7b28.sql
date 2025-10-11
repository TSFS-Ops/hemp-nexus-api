-- Drop existing policies that might cause recursion
DROP POLICY IF EXISTS "Users can view their org's API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Admins can manage API keys" ON public.api_keys;

-- Create simple policies using the existing has_role function
CREATE POLICY "Users can view own org API keys"
ON public.api_keys
FOR SELECT
TO authenticated
USING (
  org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
);

CREATE POLICY "Admins can manage API keys"
ON public.api_keys
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can create API keys"
ON public.api_keys
FOR INSERT
TO authenticated
WITH CHECK (
  org_id = (SELECT org_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
);