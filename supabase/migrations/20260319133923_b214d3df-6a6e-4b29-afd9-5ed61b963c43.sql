
-- ============================================================
-- COUNTERPARTY VISIBILITY: Update RLS policies so buyer_org_id
-- and seller_org_id grant read access across the match workspace.
-- ============================================================

-- Helper: security definer function to check if a user's org is a
-- participant (owner, buyer, or seller) on a given match.
CREATE OR REPLACE FUNCTION public.is_match_participant(_user_id uuid, _match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM matches m
    JOIN profiles p ON p.id = _user_id
    WHERE m.id = _match_id
      AND (
        m.org_id = p.org_id
        OR m.buyer_org_id = p.org_id
        OR m.seller_org_id = p.org_id
      )
  )
$$;

-- 1. MATCHES — Replace SELECT policy to include buyer/seller orgs
DROP POLICY IF EXISTS "Users can view their org's matches" ON public.matches;
CREATE POLICY "Users can view matches they participate in"
  ON public.matches FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    OR buyer_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    OR seller_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
  );

-- 2. DISPUTES — Replace SELECT policy to include counterparty visibility
DROP POLICY IF EXISTS "Org members view disputes" ON public.disputes;
CREATE POLICY "Match participants can view disputes"
  ON public.disputes FOR SELECT TO authenticated
  USING (
    raised_by_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    OR public.is_match_participant(auth.uid(), match_id)
    OR is_admin(auth.uid())
  );

-- Allow counterparties to raise disputes too (not just the creating org)
DROP POLICY IF EXISTS "Org members create disputes" ON public.disputes;
CREATE POLICY "Match participants can create disputes"
  ON public.disputes FOR INSERT TO authenticated
  WITH CHECK (
    raised_by_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    AND public.is_match_participant(auth.uid(), match_id)
  );

-- 3. DEAL_TERMS — Replace SELECT policy to include counterparties
DROP POLICY IF EXISTS "Org members view deal terms" ON public.deal_terms;
CREATE POLICY "Match participants can view deal terms"
  ON public.deal_terms FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    OR public.is_match_participant(auth.uid(), match_id)
  );

-- Allow counterparties to propose deal terms
DROP POLICY IF EXISTS "Org members create deal terms" ON public.deal_terms;
CREATE POLICY "Match participants can create deal terms"
  ON public.deal_terms FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    AND public.is_match_participant(auth.uid(), match_id)
  );

-- 4. MATCH_EVENTS — Replace SELECT policy to include counterparties
DROP POLICY IF EXISTS "Users can view their org's match events" ON public.match_events;
CREATE POLICY "Match participants can view match events"
  ON public.match_events FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    OR public.is_match_participant(auth.uid(), match_id)
  );

-- 5. MATCH_DOCUMENTS — The existing policy already handles counterparty
-- visibility via buyer_org_id/seller_org_id checks for shared docs.
-- But we need to ensure basic document listing works for counterparties.
-- The existing policy already covers this via the match_id join. No change needed.

-- 6. Revoke EXECUTE from anon/public for new function (security hardening)
REVOKE EXECUTE ON FUNCTION public.is_match_participant(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_match_participant(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_match_participant(uuid, uuid) TO authenticated;
