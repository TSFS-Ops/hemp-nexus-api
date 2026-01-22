-- Tighten RLS policies flagged by security scanner

-- 1) PROFILES: ensure strict self-only access, explicit WITH CHECK on UPDATE, and remove any ambiguity
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND id = auth.uid()
);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND id = auth.uid()
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND id = auth.uid()
);

-- Keep admin policy as-is (if present)
-- (No change to "Admins can manage all profiles" and "Admins can insert profiles")


-- 2) DATA SOURCE REGISTRATIONS: enforce strict org equality to the viewer's org, not IN() list
ALTER TABLE public.data_source_registrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view registrations for their org" ON public.data_source_registrations;
CREATE POLICY "Users can view registrations for their org"
ON public.data_source_registrations
FOR SELECT
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND org_id IS NOT NULL
  AND org_id = (
    SELECT p.org_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "Users can create registrations for their org" ON public.data_source_registrations;
CREATE POLICY "Users can create registrations for their org"
ON public.data_source_registrations
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() IS NOT NULL
  AND org_id IS NOT NULL
  AND org_id = (
    SELECT p.org_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1
  )
);

DROP POLICY IF EXISTS "Users can update their org's registrations" ON public.data_source_registrations;
CREATE POLICY "Users can update their org's registrations"
ON public.data_source_registrations
FOR UPDATE
TO authenticated
USING (
  auth.uid() IS NOT NULL
  AND org_id IS NOT NULL
  AND org_id = (
    SELECT p.org_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1
  )
)
WITH CHECK (
  auth.uid() IS NOT NULL
  AND org_id IS NOT NULL
  AND org_id = (
    SELECT p.org_id
    FROM public.profiles p
    WHERE p.id = auth.uid()
    LIMIT 1
  )
);

-- Keep admin policy as-is ("Admins can manage all registrations")
