
-- Phase 2 AI Light-Intel Lifecycle: schema + helper functions only.

-- 1. Per-match AI run counter on matches
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS ai_run_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_auto_trigger_status text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'matches_ai_auto_trigger_status_check'
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_ai_auto_trigger_status_check
      CHECK (
        ai_auto_trigger_status IS NULL
        OR ai_auto_trigger_status IN (
          'pending','enqueued','skipped','completed','failed','capped','provider_failed'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_ai_auto_trigger_status
  ON public.matches (ai_auto_trigger_status)
  WHERE ai_auto_trigger_status IS NOT NULL;

-- 2. Atomic per-match run counter. Returns the new count, or -1 if cap exceeded.
CREATE OR REPLACE FUNCTION public.ai_increment_match_run_count(
  p_match_id uuid,
  p_max_runs integer
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new integer;
BEGIN
  UPDATE public.matches
     SET ai_run_count = ai_run_count + 1,
         ai_last_run_at = now()
   WHERE id = p_match_id
     AND ai_run_count < p_max_runs
  RETURNING ai_run_count INTO v_new;

  IF v_new IS NULL THEN
    RETURN -1;
  END IF;

  RETURN v_new;
END $$;

REVOKE EXECUTE ON FUNCTION public.ai_increment_match_run_count(uuid, integer) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ai_increment_match_run_count(uuid, integer) TO service_role;

-- 3. Eligibility predicate — unknown OR not-yet-onboarded counterparty.
CREATE OR REPLACE FUNCTION public.is_counterparty_unknown_for_match(p_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer  uuid;
  v_seller uuid;
  v_b_status text;
  v_s_status text;
BEGIN
  SELECT buyer_org_id, seller_org_id INTO v_buyer, v_seller
    FROM public.matches WHERE id = p_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Either side unlinked → unknown.
  IF v_buyer IS NULL OR v_seller IS NULL THEN
    RETURN true;
  END IF;

  SELECT status INTO v_b_status FROM public.organizations WHERE id = v_buyer;
  SELECT status INTO v_s_status FROM public.organizations WHERE id = v_seller;

  -- Either side still pre-onboarded → unknown.
  IF v_b_status IS NULL
     OR v_s_status IS NULL
     OR v_b_status IN ('invited','pending','pending_onboarding','draft','suspended')
     OR v_s_status IN ('invited','pending','pending_onboarding','draft','suspended')
  THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

REVOKE EXECUTE ON FUNCTION public.is_counterparty_unknown_for_match(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_counterparty_unknown_for_match(uuid) TO service_role;

-- 4. Linkage predicate used by lifecycle scheduler — true when a proposed match
-- is referenced by any operational record and therefore must NOT be expired.
CREATE OR REPLACE FUNCTION public.ai_proposed_match_is_linked(p_proposed_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match_id uuid;
  v_tr_id    uuid;
BEGIN
  SELECT match_id, trade_request_id
    INTO v_match_id, v_tr_id
    FROM public.ai_proposed_matches
   WHERE id = p_proposed_match_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Linked to a formal match → never expire silently.
  IF v_match_id IS NOT NULL THEN
    RETURN true;
  END IF;

  -- Outreach drafts (V2) referencing this proposed_match
  IF EXISTS (
    SELECT 1 FROM public.ai_outreach_drafts_v2 d
     WHERE d.proposed_match_id = p_proposed_match_id
  ) THEN
    RETURN true;
  END IF;

  -- Engagement outreach against the same trade request
  IF v_tr_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.engagement_outreach_drafts e
     WHERE e.trade_request_id = v_tr_id
  ) THEN
    RETURN true;
  END IF;

  -- POI created against the trade request
  IF v_tr_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pois p
     WHERE p.trade_request_id = v_tr_id
  ) THEN
    RETURN true;
  END IF;

  -- Open admin intel task referencing this proposed match
  IF EXISTS (
    SELECT 1 FROM public.ai_intel_tasks t
     WHERE t.proposed_match_id = p_proposed_match_id
       AND t.status IN ('open','in_progress')
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

REVOKE EXECUTE ON FUNCTION public.ai_proposed_match_is_linked(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.ai_proposed_match_is_linked(uuid) TO service_role;
