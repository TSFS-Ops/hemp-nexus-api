CREATE OR REPLACE FUNCTION public.sync_match_counterparty_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_match RECORD;
  v_filled_side TEXT;
BEGIN
  IF NEW.counterparty_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.counterparty_org_id IS NOT DISTINCT FROM NEW.counterparty_org_id THEN
    RETURN NEW;
  END IF;

  SELECT id, org_id, buyer_org_id, seller_org_id
    INTO v_match
    FROM public.matches
   WHERE id = NEW.match_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_match.buyer_org_id = v_match.org_id
     AND v_match.seller_org_id IS NULL THEN
    UPDATE public.matches
       SET seller_org_id = NEW.counterparty_org_id
     WHERE id = v_match.id;
    v_filled_side := 'seller_org_id';

  ELSIF v_match.seller_org_id = v_match.org_id
        AND v_match.buyer_org_id IS NULL THEN
    UPDATE public.matches
       SET buyer_org_id = NEW.counterparty_org_id
     WHERE id = v_match.id;
    v_filled_side := 'buyer_org_id';
  END IF;

  IF v_filled_side IS NOT NULL THEN
    INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
    VALUES (
      'match.counterparty_side.auto_filled',
      'matches',
      v_match.id::text,
      jsonb_build_object(
        'filled_side', v_filled_side,
        'engagement_id', NEW.id,
        'counterparty_org_id', NEW.counterparty_org_id,
        'counterparty_email', NEW.counterparty_email,
        'trigger', 'sync_match_counterparty_org'
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_engagements_on_profile_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_email TEXT;
  v_engagement RECORD;
BEGIN
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.org_id IS NOT DISTINCT FROM NEW.org_id THEN
    RETURN NEW;
  END IF;

  v_email := lower(trim(NEW.email));
  IF v_email IS NULL OR v_email = '' THEN
    RETURN NEW;
  END IF;

  FOR v_engagement IN
    SELECT id, match_id, counterparty_email
      FROM public.poi_engagements
     WHERE counterparty_org_id IS NULL
       AND lower(trim(counterparty_email)) = v_email
  LOOP
    UPDATE public.poi_engagements
       SET counterparty_org_id = NEW.org_id,
           updated_at = now()
     WHERE id = v_engagement.id
       AND counterparty_org_id IS NULL;

    INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
    VALUES (
      'engagement.counterparty_org.backfilled_on_signup',
      'poi_engagements',
      v_engagement.id::text,
      jsonb_build_object(
        'profile_id', NEW.id,
        'matched_email', v_email,
        'counterparty_org_id', NEW.org_id,
        'match_id', v_engagement.match_id,
        'trigger', 'backfill_engagements_on_profile_org'
      )
    );
  END LOOP;

  RETURN NEW;
END;
$function$;