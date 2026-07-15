
-- 1. Add nullable team_key (NULL = global default row)
ALTER TABLE public.support_sla_targets
  ADD COLUMN IF NOT EXISTS team_key text REFERENCES public.support_teams(key) ON DELETE CASCADE;

-- 2. Replace the priority-only PK with a composite unique that treats
--    NULL team_key as the global default. A unique expression index over
--    coalesce(team_key,'') gives us "one row per (team, priority)".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'support_sla_targets_pkey') THEN
    ALTER TABLE public.support_sla_targets DROP CONSTRAINT support_sla_targets_pkey;
  END IF;
END $$;

ALTER TABLE public.support_sla_targets
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.support_sla_targets
  ADD CONSTRAINT support_sla_targets_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS support_sla_targets_team_priority_uniq
  ON public.support_sla_targets (COALESCE(team_key, ''), priority);

-- 3. Update the routing/SLA-apply trigger to prefer a team-specific row.
CREATE OR REPLACE FUNCTION public._support_apply_routing_and_sla()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_team text;
  v_first_min integer;
  v_res_min integer;
BEGIN
  SELECT team_key INTO v_team FROM public.support_category_routing
    WHERE is_active AND category_key = NEW.category_key
      AND (subcategory_key IS NOT DISTINCT FROM NEW.subcategory_key)
    ORDER BY subcategory_key NULLS LAST LIMIT 1;
  IF v_team IS NULL THEN
    SELECT team_key INTO v_team FROM public.support_category_routing
      WHERE is_active AND category_key = NEW.category_key AND subcategory_key IS NULL LIMIT 1;
  END IF;
  IF v_team IS NULL THEN v_team := 'triage'; END IF;
  NEW.current_team_key := v_team;

  -- Team-specific override
  SELECT first_response_minutes, resolution_minutes
    INTO v_first_min, v_res_min
    FROM public.support_sla_targets
    WHERE team_key = v_team AND priority = NEW.priority
    LIMIT 1;

  -- Fallback to global default (team_key IS NULL)
  IF v_first_min IS NULL THEN
    SELECT first_response_minutes, resolution_minutes
      INTO v_first_min, v_res_min
      FROM public.support_sla_targets
      WHERE team_key IS NULL AND priority = NEW.priority
      LIMIT 1;
  END IF;

  IF v_first_min IS NOT NULL THEN
    NEW.sla_first_response_due_at := NEW.created_at + make_interval(mins => v_first_min);
  END IF;
  IF v_res_min IS NOT NULL THEN
    NEW.sla_resolution_due_at := NEW.created_at + make_interval(mins => v_res_min);
  END IF;
  RETURN NEW;
END $$;
