
CREATE OR REPLACE FUNCTION public.match_challenges_immutable_fields_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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

CREATE OR REPLACE FUNCTION public.match_challenges_state_machine_trg()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
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
