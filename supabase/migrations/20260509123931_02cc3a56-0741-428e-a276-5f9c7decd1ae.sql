
-- =====================================================================
-- Batch C Phase 1 — Correction Pass
-- 1. Tighten platform_admin INSERT shape on match_challenges
-- 2. Make closed_no_action >= 40 char outcome_summary explicit (named constraint)
-- No new tables. Legacy public.disputes untouched. No rating emission code added.
-- =====================================================================

-- (1) Replace overly-permissive INSERT policy.
-- Previous policy: is_admin(auth.uid()) bypassed role-shape consistency,
-- letting a platform_admin write raised_by_role='buyer_org_admin' with arbitrary
-- raised_by_org_id. New policy enforces three mutually exclusive shapes:
--   a) party-org-admin row: role in (buyer_org_admin, seller_org_admin),
--      raised_by_org_id matches the corresponding side of the match,
--      caller is org_admin of that org AND a party org_admin on the match.
--   b) platform-raised row: role = 'platform_admin', raised_by_org_id IS NULL,
--      caller is platform_admin (is_admin).
DROP POLICY IF EXISTS "challenges_insert_party_admins_or_platform" ON public.match_challenges;

CREATE POLICY "challenges_insert_strict_shape"
  ON public.match_challenges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    raised_by_user_id = auth.uid()
    AND (
      -- (b) Platform-raised
      (
        raised_by_role = 'platform_admin'
        AND raised_by_org_id IS NULL
        AND public.is_admin(auth.uid())
      )
      OR
      -- (a) Party-org-admin raised
      (
        raised_by_role IN ('buyer_org_admin','seller_org_admin')
        AND raised_by_org_id IS NOT NULL
        AND public.is_org_admin(auth.uid(), raised_by_org_id)
        AND public.is_match_party_org_admin(auth.uid(), match_id)
        AND EXISTS (
          SELECT 1 FROM public.matches m
          WHERE m.id = match_id
            AND (
              (raised_by_role = 'buyer_org_admin'  AND raised_by_org_id = m.buyer_org_id)
              OR
              (raised_by_role = 'seller_org_admin' AND raised_by_org_id = m.seller_org_id)
            )
        )
      )
    )
  );

-- (2) Make closed_no_action minimum-length explicit at the table level.
-- Column-level check already enforces (outcome_summary IS NULL OR length>=40),
-- so combined with the existing NOT NULL requirement this is already true,
-- but we add an explicit named constraint so it is visible in audit.
ALTER TABLE public.match_challenges
  DROP CONSTRAINT IF EXISTS match_challenges_closed_no_action_min_length;

ALTER TABLE public.match_challenges
  ADD CONSTRAINT match_challenges_closed_no_action_min_length
  CHECK (
    status <> 'closed_no_action'
    OR (outcome_summary IS NOT NULL AND char_length(outcome_summary) >= 40)
  );
