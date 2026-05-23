
-- 1) Remove admin_settings from realtime publication so its row changes
--    are not broadcast to every authenticated subscriber.
ALTER PUBLICATION supabase_realtime DROP TABLE public.admin_settings;

-- 2) Replace the permissive counterparty_ratings SELECT policy with a
--    relationship-scoped policy.
DROP POLICY IF EXISTS "Authenticated users view counterparty ratings"
  ON public.counterparty_ratings;

CREATE POLICY "Counterparty ratings visible to related orgs and admins"
ON public.counterparty_ratings
FOR SELECT
TO authenticated
USING (
  -- Platform admins always see.
  public.is_admin(auth.uid())
  -- Members of the rated org see their own row.
  OR org_id IN (
    SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
  )
  -- Members of an org with an active match relationship with the rated
  -- org can see the rated org's score.
  OR EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE
      (
        (m.buyer_org_id = counterparty_ratings.org_id
         AND m.seller_org_id IN (
           SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
         ))
        OR
        (m.seller_org_id = counterparty_ratings.org_id
         AND m.buyer_org_id IN (
           SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
         ))
      )
  )
);
