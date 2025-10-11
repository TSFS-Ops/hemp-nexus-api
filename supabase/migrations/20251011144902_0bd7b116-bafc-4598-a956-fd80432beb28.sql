-- Fix infinite recursion in profiles RLS policies
DROP POLICY IF EXISTS "Users can view profiles in their org" ON public.profiles;

-- Create a simpler policy that doesn't cause recursion
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Users can view profiles in their org"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  org_id = (
    SELECT org_id 
    FROM public.profiles 
    WHERE id = auth.uid() 
    LIMIT 1
  )
);