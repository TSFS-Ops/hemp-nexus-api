-- CP-009 / DEC-003 fixture unblock: delete stale non-demo engagement rows
-- that drifted onto the demo match DEMO-CP009-LATE-ACCEPT-001 and were
-- blocking the seeder's late-acceptance transition via the
-- uq_poi_engagements_one_current_per_match unique index.
DELETE FROM public.poi_engagements e
USING public.matches m
WHERE e.match_id = m.id
  AND m.hash = 'DEMO-CP009-LATE-ACCEPT-001'
  AND m.is_demo = true
  AND e.is_demo = false;
