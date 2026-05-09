
-- =====================================================================
-- Batch C Phase 1 — Match Challenges (schema + RLS only)
-- Legacy public.disputes is intentionally left untouched.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.is_match_participant_member(_user_id uuid, _match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    JOIN public.profiles p ON p.id = _user_id
    WHERE m.id = _match_id
      AND p.org_id IS NOT NULL
      AND p.org_id IN (m.buyer_org_id, m.seller_org_id, m.org_id)
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_match_participant_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_match_participant_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_match_party_org_admin(_user_id uuid, _match_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.matches m
    WHERE m.id = _match_id
      AND (
        public.is_org_admin(_user_id, m.buyer_org_id)
        OR public.is_org_admin(_user_id, m.seller_org_id)
        OR (m.org_id IS NOT NULL AND public.is_org_admin(_user_id, m.org_id))
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_match_party_org_admin(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_match_party_org_admin(uuid, uuid) TO authenticated, service_role;

-- =====================================================================
CREATE TABLE public.match_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL,
  raised_by_org_id uuid NULL,
  raised_by_user_id uuid NOT NULL,
  raised_by_role text NOT NULL
    CHECK (raised_by_role IN ('buyer_org_admin','seller_org_admin','platform_admin')),
  subject_code text NOT NULL
    CHECK (subject_code IN (
      'terms_disagreement',
      'evidence_quality_concern',
      'identity_concern',
      'compliance_concern',
      'delivery_or_settlement_concern',
      'other'
    )),
  summary text NOT NULL
    CHECK (char_length(summary) BETWEEN 20 AND 2000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','withdrawn','outcome_recorded','closed_no_action')),
  outcome_code text NULL
    CHECK (outcome_code IS NULL OR outcome_code IN (
      'no_action_required',
      'corrected_and_proceed',
      'withdrawn_by_raiser',
      'superseded_by_updated_terms',
      'evidence_required',
      'cannot_proceed',
      'admin_override_recorded'
    )),
  outcome_summary text NULL
    CHECK (outcome_summary IS NULL OR char_length(outcome_summary) >= 40),
  under_review_at timestamptz NULL,
  closed_at timestamptz NULL,
  closed_by_user_id uuid NULL,
  break_glass_override_used boolean NOT NULL DEFAULT false,
  rating_impact_emitted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_challenges_outcome_recorded_requires_code
    CHECK (status <> 'outcome_recorded' OR (outcome_code IS NOT NULL AND outcome_summary IS NOT NULL)),
  CONSTRAINT match_challenges_closed_no_action_requires_summary
    CHECK (status <> 'closed_no_action' OR outcome_summary IS NOT NULL),
  CONSTRAINT match_challenges_withdrawn_uses_withdrawn_outcome
    CHECK (status <> 'withdrawn' OR outcome_code = 'withdrawn_by_raiser')
);

CREATE INDEX idx_match_challenges_match_id ON public.match_challenges(match_id);
CREATE INDEX idx_match_challenges_org_id ON public.match_challenges(org_id);
CREATE INDEX idx_match_challenges_status ON public.match_challenges(status);

CREATE UNIQUE INDEX uniq_match_challenge_open_per_match
  ON public.match_challenges(match_id)
  WHERE status IN ('open','under_review');

CREATE OR REPLACE FUNCTION public.match_challenges_immutable_fields_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.match_id           IS DISTINCT FROM OLD.match_id           THEN RAISE EXCEPTION 'match_id is immutable'; END IF;
  IF NEW.raised_by_org_id   IS DISTINCT FROM OLD.raised_by_org_id   THEN RAISE EXCEPTION 'raised_by_org_id is immutable'; END IF;
  IF NEW.raised_by_user_id  IS DISTINCT FROM OLD.raised_by_user_id  THEN RAISE EXCEPTION 'raised_by_user_id is immutable'; END IF;
  IF NEW.raised_by_role     IS DISTINCT FROM OLD.raised_by_role     THEN RAISE EXCEPTION 'raised_by_role is immutable'; END IF;
  IF NEW.subject_code       IS DISTINCT FROM OLD.subject_code       THEN RAISE EXCEPTION 'subject_code is immutable'; END IF;
  IF NEW.summary            IS DISTINCT FROM OLD.summary            THEN RAISE EXCEPTION 'summary is immutable'; END IF;
  IF NEW.org_id             IS DISTINCT FROM OLD.org_id             THEN RAISE EXCEPTION 'org_id is immutable'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER trg_match_challenges_immutable_fields
BEFORE UPDATE ON public.match_challenges
FOR EACH ROW EXECUTE FUNCTION public.match_challenges_immutable_fields_trg();

CREATE OR REPLACE FUNCTION public.match_challenges_state_machine_trg()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_terminal text[] := ARRAY['withdrawn','outcome_recorded','closed_no_action'];
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = ANY(v_terminal) THEN
    RAISE EXCEPTION 'match_challenges status % is terminal and cannot transition', OLD.status;
  END IF;

  IF OLD.status = 'open' AND NEW.status NOT IN ('under_review','withdrawn','closed_no_action') THEN
    RAISE EXCEPTION 'invalid transition open -> %', NEW.status;
  END IF;

  IF OLD.status = 'under_review' AND NEW.status NOT IN ('outcome_recorded','closed_no_action') THEN
    RAISE EXCEPTION 'invalid transition under_review -> %', NEW.status;
  END IF;

  IF NEW.status = 'outcome_recorded' THEN
    IF NEW.outcome_code IS NULL OR NEW.outcome_code = 'withdrawn_by_raiser' THEN
      RAISE EXCEPTION 'outcome_recorded requires a valid outcome_code (not withdrawn_by_raiser)';
    END IF;
    IF NEW.outcome_summary IS NULL OR char_length(NEW.outcome_summary) < 40 THEN
      RAISE EXCEPTION 'outcome_recorded requires outcome_summary of at least 40 characters';
    END IF;
  END IF;

  IF NEW.status = 'withdrawn' AND NEW.outcome_code <> 'withdrawn_by_raiser' THEN
    RAISE EXCEPTION 'withdrawn rows must use outcome_code = withdrawn_by_raiser';
  END IF;

  IF NEW.status IN ('withdrawn','outcome_recorded','closed_no_action') AND NEW.closed_at IS NULL THEN
    NEW.closed_at := now();
  END IF;

  IF NEW.status = 'under_review' AND NEW.under_review_at IS NULL THEN
    NEW.under_review_at := now();
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER trg_match_challenges_state_machine
BEFORE UPDATE OF status ON public.match_challenges
FOR EACH ROW EXECUTE FUNCTION public.match_challenges_state_machine_trg();

-- =====================================================================
CREATE TABLE public.match_challenge_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.match_challenges(id) ON DELETE CASCADE,
  author_user_id uuid NOT NULL,
  author_org_id uuid NULL,
  author_role text NOT NULL
    CHECK (author_role IN ('buyer_org_admin','seller_org_admin','platform_admin')),
  body text NOT NULL
    CHECK (char_length(body) BETWEEN 5 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_challenge_comments_challenge_id ON public.match_challenge_comments(challenge_id);

CREATE TABLE public.match_challenge_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id uuid NOT NULL REFERENCES public.match_challenges(id) ON DELETE CASCADE,
  uploaded_by_user_id uuid NOT NULL,
  uploaded_by_org_id uuid NULL,
  storage_path text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256 text NOT NULL CHECK (char_length(sha256) = 64),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_match_challenge_evidence_challenge_id ON public.match_challenge_evidence(challenge_id);

-- =====================================================================
ALTER TABLE public.match_challenges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_challenge_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_challenge_evidence  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "challenges_select_participants"
  ON public.match_challenges
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR public.is_match_participant_member(auth.uid(), match_id)
  );

CREATE POLICY "challenges_insert_party_admins_or_platform"
  ON public.match_challenges
  FOR INSERT
  TO authenticated
  WITH CHECK (
    raised_by_user_id = auth.uid()
    AND (
      public.is_admin(auth.uid())
      OR (
        raised_by_role IN ('buyer_org_admin','seller_org_admin')
        AND raised_by_org_id IS NOT NULL
        AND public.is_org_admin(auth.uid(), raised_by_org_id)
        AND public.is_match_party_org_admin(auth.uid(), match_id)
      )
    )
  );

-- No UPDATE / DELETE policies — service role only via Phase 2 RPCs.

CREATE POLICY "challenge_comments_select_participants"
  ON public.match_challenge_comments
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.match_challenges c
      WHERE c.id = challenge_id
        AND public.is_match_participant_member(auth.uid(), c.match_id)
    )
  );

CREATE POLICY "challenge_comments_insert_party_admins_or_platform"
  ON public.match_challenge_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.match_challenges c
      WHERE c.id = challenge_id
        AND c.status IN ('open','under_review')
        AND (
          public.is_admin(auth.uid())
          OR public.is_match_party_org_admin(auth.uid(), c.match_id)
        )
    )
  );

CREATE POLICY "challenge_evidence_select_participants"
  ON public.match_challenge_evidence
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.match_challenges c
      WHERE c.id = challenge_id
        AND public.is_match_participant_member(auth.uid(), c.match_id)
    )
  );

CREATE POLICY "challenge_evidence_insert_party_admins_or_platform"
  ON public.match_challenge_evidence
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.match_challenges c
      WHERE c.id = challenge_id
        AND c.status IN ('open','under_review')
        AND (
          public.is_admin(auth.uid())
          OR public.is_match_party_org_admin(auth.uid(), c.match_id)
        )
    )
  );

-- =====================================================================
-- Storage bucket: match-challenge-evidence (private)
-- Path convention: <match_id>/<challenge_id>/<filename>
-- =====================================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('match-challenge-evidence', 'match-challenge-evidence', false, 26214400)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "challenge_evidence_storage_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'match-challenge-evidence'
    AND (
      public.is_admin(auth.uid())
      OR public.is_match_participant_member(
        auth.uid(),
        NULLIF((storage.foldername(name))[1], '')::uuid
      )
    )
  );

CREATE POLICY "challenge_evidence_storage_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'match-challenge-evidence'
    AND (
      public.is_admin(auth.uid())
      OR public.is_match_party_org_admin(
        auth.uid(),
        NULLIF((storage.foldername(name))[1], '')::uuid
      )
    )
  );

-- =====================================================================
-- Settings flag: rating impact disabled by default. No emission code shipped.
-- =====================================================================
INSERT INTO public.admin_settings (key, value)
VALUES ('challenge_rating_impact', '{"enabled": false}'::jsonb)
ON CONFLICT (key) DO NOTHING;
