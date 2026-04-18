-- ============================================================================
-- SECURITY HARDENING 2026-04-18: Close RLS WITH CHECK gaps + tighten pois
-- ============================================================================

-- 1. matches: enforce org_id ownership at INSERT time
DROP POLICY IF EXISTS "Users can create matches for their org" ON public.matches;
CREATE POLICY "Users can create matches for their org"
  ON public.matches FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND (
      buyer_org_id IS NULL
      OR buyer_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
      OR seller_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    )
  );

-- 2. match_documents: uploader_org_id MUST be caller's org
DROP POLICY IF EXISTS "Users can upload documents to POI they participate in" ON public.match_documents;
CREATE POLICY "Users can upload documents to POI they participate in"
  ON public.match_documents FOR INSERT
  TO authenticated
  WITH CHECK (
    uploader_org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND public.is_match_participant(auth.uid(), match_id)
  );

-- 3. deal_terms: org_id MUST be caller's org AND caller must participate in the match
DROP POLICY IF EXISTS "Match participants can create deal terms" ON public.deal_terms;
CREATE POLICY "Match participants can create deal terms"
  ON public.deal_terms FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND public.is_match_participant(auth.uid(), match_id)
  );

-- 4. attestations: attester and org must match caller
DROP POLICY IF EXISTS "Users can create attestations for own org" ON public.attestations;
CREATE POLICY "Users can create attestations for own org"
  ON public.attestations FOR INSERT
  TO authenticated
  WITH CHECK (
    org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
    AND attester_user_id = auth.uid()
  );

-- 5. pois: split the over-broad ALL policy into INSERT + SELECT only.
--    State transitions MUST go through atomic_* SECURITY DEFINER RPCs,
--    not direct UPDATE/DELETE from the client.
DROP POLICY IF EXISTS "Users manage own org pois" ON public.pois;

CREATE POLICY "Users can view own org pois"
  ON public.pois FOR SELECT
  TO authenticated
  USING (org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()));

CREATE POLICY "Users can create pois for own org"
  ON public.pois FOR INSERT
  TO authenticated
  WITH CHECK (org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()));

-- NB: No client-side UPDATE or DELETE policy on public.pois.
-- All mutations must go through atomic_generate_poi / poi-transition edge function
-- (which run with service role and apply state-machine guards).

-- 6. Audit-log this hardening
INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, details)
VALUES (
  NULL,
  'system.rls_hardening',
  'system',
  jsonb_build_object(
    'hardened_at', now(),
    'changes', jsonb_build_array(
      'matches.INSERT: added WITH CHECK enforcing org_id = caller org',
      'match_documents.INSERT: added WITH CHECK enforcing uploader_org_id + match participation',
      'deal_terms.INSERT: added WITH CHECK enforcing org_id + match participation',
      'attestations.INSERT: added WITH CHECK enforcing attester_user_id = auth.uid()',
      'pois: split ALL policy into SELECT + INSERT only; UPDATE/DELETE now require service role (atomic RPCs)'
    ),
    'risk_closed', 'IDOR via forged org_id on insert; in-tenant state-machine bypass'
  )
);