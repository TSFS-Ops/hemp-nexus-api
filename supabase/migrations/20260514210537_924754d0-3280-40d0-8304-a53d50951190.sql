-- POI-004 Defence-in-Depth: structural duplicate prevention for POI mint + burn
--
-- Today, atomic_generate_poi_v2 prevents duplicates behaviourally via
-- SELECT ... FOR UPDATE + state guard on matches. These partial unique
-- indexes turn that behavioural guarantee into a structural one: any future
-- RPC variant, manual INSERT, or refactor that bypasses the state guard will
-- be rejected by the database with a 23505 unique_violation rather than
-- silently producing a duplicate POI artefact or duplicate credit burn.
--
-- Scope:
--   1. ledger_events: at most ONE 'poi.minted' row per match_id.
--   2. token_ledger:  at most ONE allowed 'declare_intent' burn per match_id.
--      (failed/blocked attempts are excluded so retries after errors still work)

-- Sanity check: refuse to run if duplicates already exist (none in prod today).
DO $$
DECLARE
  v_dup_mint  int;
  v_dup_burn  int;
BEGIN
  SELECT count(*) INTO v_dup_mint FROM (
    SELECT match_id FROM public.ledger_events
     WHERE event_type = 'poi.minted' AND match_id IS NOT NULL
     GROUP BY match_id HAVING count(*) > 1
  ) d;

  SELECT count(*) INTO v_dup_burn FROM (
    SELECT (metadata->>'match_id') AS match_id
      FROM public.token_ledger
     WHERE action_type = 'declare_intent'
       AND outcome = 'allowed'
       AND metadata ? 'match_id'
     GROUP BY (metadata->>'match_id') HAVING count(*) > 1
  ) d;

  IF v_dup_mint > 0 OR v_dup_burn > 0 THEN
    RAISE EXCEPTION 'POI-004 migration aborted: duplicates exist (mint=%, burn=%). Reconcile via reconcile_poi_burns() before retrying.', v_dup_mint, v_dup_burn;
  END IF;
END$$;

-- 1. ledger_events: one poi.minted per match
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_events_poi_minted_per_match
  ON public.ledger_events (match_id)
  WHERE event_type = 'poi.minted' AND match_id IS NOT NULL;

COMMENT ON INDEX public.uq_ledger_events_poi_minted_per_match IS
  'POI-004 defence-in-depth: at most one poi.minted ledger event per match. Behavioural guard is atomic_generate_poi_v2 row lock + state check; this index is the structural backstop.';

-- 2. token_ledger: one allowed declare_intent burn per match
CREATE UNIQUE INDEX IF NOT EXISTS uq_token_ledger_declare_intent_per_match
  ON public.token_ledger ((metadata->>'match_id'))
  WHERE action_type = 'declare_intent'
    AND outcome = 'allowed'
    AND metadata ? 'match_id';

COMMENT ON INDEX public.uq_token_ledger_declare_intent_per_match IS
  'POI-004 defence-in-depth: at most one allowed declare_intent burn per match (failed/blocked attempts excluded so retries after errors are still recorded). Structural backstop to atomic_generate_poi_v2.';
