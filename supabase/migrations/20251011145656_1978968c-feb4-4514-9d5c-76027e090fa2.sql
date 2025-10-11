-- Remove self-referential policy causing recursion
DROP POLICY IF EXISTS "Users can view profiles in same org" ON public.profiles;

-- Remove helper function that queried profiles from a profiles policy
DROP FUNCTION IF EXISTS public.get_user_org_id(uuid);

-- Ensure minimal safe policies remain
DO $$ BEGIN
  -- Own profile select policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Users can view their own profile'
  ) THEN
    CREATE POLICY "Users can view their own profile"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (id = auth.uid());
  END IF;

  -- Admin manage all policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Admins can manage all profiles'
  ) THEN
    CREATE POLICY "Admins can manage all profiles"
    ON public.profiles
    FOR ALL
    TO authenticated
    USING (public.has_role(auth.uid(), 'admin'));
  END IF;
END $$;