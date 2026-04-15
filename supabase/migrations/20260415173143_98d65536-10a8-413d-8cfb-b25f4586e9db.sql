CREATE OR REPLACE FUNCTION public.auto_link_engagement_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_email text;
  v_org_id uuid;
  v_linked_count int;
  v_eng RECORD;
BEGIN
  v_org_id := NEW.org_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = NEW.id;
  IF v_user_email IS NULL OR v_user_email = '' THEN
    RETURN NEW;
  END IF;

  -- Auto-link pending engagements where counterparty_email matches
  FOR v_eng IN
    UPDATE public.poi_engagements
    SET counterparty_org_id = v_org_id, counterparty_type = 'known'
    WHERE lower(counterparty_email) = lower(v_user_email)
      AND engagement_status IN ('notification_sent', 'contacted')
      AND counterparty_org_id IS NULL
    RETURNING *
  LOOP
    -- Fill the vacant buyer/seller slot on the linked match
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

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;

  IF v_linked_count > 0 THEN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      NULL, 'engagement.auto_linked', 'profile', NEW.id::text,
      jsonb_build_object('user_email', v_user_email, 'org_id', v_org_id, 'linked_engagement_count', v_linked_count)
    );
  END IF;

  RETURN NEW;
END;
$function$;