-- Trigger: when a profile gains an org_id (signup or org assignment),
-- scan for POI engagements addressed to that email and bind them to
-- the new org. This composes with sync_match_counterparty_org() so the
-- receiving organisation's matches list immediately reflects the trade.

CREATE OR REPLACE FUNCTION public.backfill_engagements_on_profile_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
  v_count INT := 0;
  r RECORD;
BEGIN
  -- Only act when the profile is gaining an org (NULL → non-NULL or change).
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.org_id IS NOT DISTINCT FROM NEW.org_id THEN
    RETURN NEW;
  END IF;

  -- Normalise the email for case-insensitive matching.
  v_email := lower(trim(NEW.email));
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  FOR r IN
    SELECT id
      FROM public.poi_engagements
     WHERE counterparty_org_id IS NULL
       AND lower(counterparty_email) = v_email
  LOOP
    -- Trigger sync_match_counterparty_org() will fire on this update
    -- and back-fill the parent match's empty side.
    UPDATE public.poi_engagements
       SET counterparty_org_id = NEW.org_id,
           counterparty_type   = 'known',
           updated_at          = now()
     WHERE id = r.id;

    v_count := v_count + 1;

    BEGIN
      INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
      VALUES (
        NEW.org_id,
        'poi_engagement',
        r.id,
        'engagement.counterparty_org_backfilled',
        jsonb_build_object(
          'profile_id', NEW.id,
          'email', v_email,
          'counterparty_org_id', NEW.org_id,
          'source', 'signup_backfill_trigger'
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  IF v_count > 0 THEN
    RAISE NOTICE 'backfill_engagements_on_profile_org: bound % engagement(s) to org %', v_count, NEW.org_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backfill_engagements_on_profile_org ON public.profiles;

CREATE TRIGGER trg_backfill_engagements_on_profile_org
AFTER INSERT OR UPDATE OF org_id ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.backfill_engagements_on_profile_org();