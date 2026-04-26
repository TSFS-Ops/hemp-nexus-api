-- ─────────────────────────────────────────────────────────────────
-- touch_match_view(_match_id)
--
-- Records that the calling user just opened a match. Used by the
-- Match Details page so the Deal Pipeline can display a meaningful
-- "last viewed" timestamp instead of the stale created_at.
--
-- - SECURITY DEFINER so it can upsert under the user's own id
--   without needing a permissive RLS policy.
-- - Hard-binds user_id := auth.uid(); the parameter is ONLY the
--   match id, so a caller cannot touch another user's row.
-- - No-ops cleanly when called unauthenticated.
-- ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_match_view(_match_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
BEGIN
  IF _uid IS NULL OR _match_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.match_ui_prefs (user_id, match_id, sub_tab, updated_at, created_at)
  VALUES (_uid, _match_id, 'terms', _now, _now)
  ON CONFLICT (user_id, match_id)
  DO UPDATE SET updated_at = EXCLUDED.updated_at;

  RETURN _now;
END;
$$;

REVOKE ALL ON FUNCTION public.touch_match_view(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.touch_match_view(uuid) TO authenticated;
