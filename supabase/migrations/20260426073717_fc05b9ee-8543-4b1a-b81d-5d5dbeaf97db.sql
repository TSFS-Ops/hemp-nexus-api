CREATE POLICY "Users insert own org ubo_links"
ON public.ubo_links
FOR INSERT
TO authenticated
WITH CHECK (
  org_id IN (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
);

CREATE POLICY "Users update own org ubo_links"
ON public.ubo_links
FOR UPDATE
TO authenticated
USING (
  org_id IN (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
)
WITH CHECK (
  org_id IN (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
);

CREATE POLICY "Users delete own org ubo_links"
ON public.ubo_links
FOR DELETE
TO authenticated
USING (
  org_id IN (
    SELECT profiles.org_id
    FROM public.profiles
    WHERE profiles.id = auth.uid()
  )
);