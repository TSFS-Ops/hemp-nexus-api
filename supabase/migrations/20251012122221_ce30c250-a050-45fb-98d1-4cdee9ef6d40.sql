-- Fix api_keys table public exposure by restricting to authenticated users only

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own org API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Admins can manage API keys" ON public.api_keys;
DROP POLICY IF EXISTS "Users can create API keys" ON public.api_keys;

-- Create new restrictive policies that explicitly require authentication

-- Allow authenticated users to view API keys from their own organization
CREATE POLICY "Authenticated users can view own org API keys"
ON public.api_keys
FOR SELECT
TO authenticated
USING (
  org_id = (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
    LIMIT 1
  )
);

-- Allow authenticated users to create API keys for their own organization
CREATE POLICY "Authenticated users can create API keys"
ON public.api_keys
FOR INSERT
TO authenticated
WITH CHECK (
  org_id = (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
    LIMIT 1
  )
);

-- Allow authenticated users to update API keys in their own organization
CREATE POLICY "Authenticated users can update own org API keys"
ON public.api_keys
FOR UPDATE
TO authenticated
USING (
  org_id = (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
    LIMIT 1
  )
)
WITH CHECK (
  org_id = (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
    LIMIT 1
  )
);

-- Allow authenticated users to delete API keys in their own organization
CREATE POLICY "Authenticated users can delete own org API keys"
ON public.api_keys
FOR DELETE
TO authenticated
USING (
  org_id = (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
    LIMIT 1
  )
);

-- Admins can manage all API keys
CREATE POLICY "Admins can manage all API keys"
ON public.api_keys
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));