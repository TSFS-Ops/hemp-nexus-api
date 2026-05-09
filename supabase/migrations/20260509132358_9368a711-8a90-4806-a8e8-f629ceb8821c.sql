
-- Phase 2b E2E test lever: force a deterministic DB-insert failure
-- so we can prove the upload-evidence route cleans up the orphaned
-- storage object. Magic prefix is namespaced and impossible to hit
-- via the upload-evidence sanitiser (which only allows [A-Za-z0-9._-]
-- but accepts underscores, so the prefix is reachable only intentionally).
CREATE OR REPLACE FUNCTION public._phase2b_force_fail_evidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.filename LIKE '\_\_PHASE2B\_FORCE\_FAIL\_\_%' ESCAPE '\' THEN
    RAISE EXCEPTION 'phase2b_force_fail: deliberate insert failure for orphan-cleanup proof';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS _phase2b_force_fail_evidence_trg ON public.match_challenge_evidence;
CREATE TRIGGER _phase2b_force_fail_evidence_trg
  BEFORE INSERT ON public.match_challenge_evidence
  FOR EACH ROW
  EXECUTE FUNCTION public._phase2b_force_fail_evidence();

COMMENT ON FUNCTION public._phase2b_force_fail_evidence() IS
  'Phase 2b E2E test lever: deliberately fails inserts whose filename starts with __PHASE2B_FORCE_FAIL__ so the upload-evidence orphan-cleanup path can be proven against the deployed function. Safe in production; impossible to hit by normal use.';
