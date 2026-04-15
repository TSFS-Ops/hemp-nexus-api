CREATE OR REPLACE FUNCTION public.auto_link_counterparty_on_registration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_org_id uuid;
  v_eng RECORD;
BEGIN
  -- Get the new user's org_id from their profile
  SELECT org_id INTO v_org_id FROM profiles WHERE id = NEW.id;
  
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Link any pending engagements where email matches,
  -- and fill the vacant buyer/seller slot on each linked match
  FOR v_eng IN
    UPDATE poi_engagements
    SET counterparty_org_id = v_org_id,
        counterparty_type = 'known',
        engagement_status = 'contacted'
    WHERE counterparty_email = NEW.email
      AND counterparty_org_id IS NULL
      AND engagement_status IN ('notification_sent', 'contacted')
    RETURNING *
  LOOP
    IF v_eng.match_id IS NOT NULL THEN
      UPDATE public.matches
      SET buyer_org_id = v_org_id
      WHERE id = v_eng.match_id
        AND buyer_org_id IS NULL
        AND seller_org_id IS NOT NULL;

      IF NOT FOUND THEN
        UPDATE public.matches
        SET seller_org_id = v_org_id
        WHERE id = v_eng.match_id
          AND seller_org_id IS NULL
          AND buyer_org_id IS NOT NULL;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;