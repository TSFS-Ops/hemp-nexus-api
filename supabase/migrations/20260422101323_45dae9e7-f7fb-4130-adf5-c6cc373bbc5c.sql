-- =============================================================
-- Auto-link engagement on signup → also send welcome email to the
-- newly-linked counterparty with a deep link to their match.
--
-- Approach:
--   1. Existing logic: when a profile receives an org_id, find any
--      pending poi_engagements whose counterparty_email matches the
--      user's email, link them, and fill the vacant buyer/seller slot
--      on the related match.
--   2. NEW: for each engagement that was just linked, enqueue an HTTP
--      call to send-transactional-email via pg_net so the recipient
--      receives a branded welcome email with a deep link to the match.
--   3. Service-role auth: pulled from the same vault secret used by the
--      email queue cron job ('email_queue_service_role_key').
--
-- Failure isolation: pg_net.http_post is non-blocking. If the edge
-- function fails or the vault secret is missing, the trigger does NOT
-- raise — the auto-link still succeeds and is auditable.
-- =============================================================

CREATE OR REPLACE FUNCTION public.auto_link_engagement_on_signup()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_email text;
  v_user_full_name text;
  v_org_id uuid;
  v_linked_count int := 0;
  v_eng RECORD;
  v_match RECORD;
  v_initiator_org_name text;
  v_recipient_side text;
  v_service_key text;
  v_payload jsonb;
BEGIN
  v_org_id := NEW.org_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT email, raw_user_meta_data ->> 'full_name'
    INTO v_user_email, v_user_full_name
  FROM auth.users
  WHERE id = NEW.id;

  IF v_user_email IS NULL OR v_user_email = '' THEN
    RETURN NEW;
  END IF;

  -- Pull service-role key from vault once (used for pg_net auth header).
  -- If absent, email dispatch is skipped silently — link still succeeds.
  BEGIN
    SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets
    WHERE name = 'email_queue_service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_service_key := NULL;
  END;

  -- Auto-link pending engagements where counterparty_email matches.
  FOR v_eng IN
    UPDATE public.poi_engagements
    SET counterparty_org_id = v_org_id, counterparty_type = 'known'
    WHERE lower(counterparty_email) = lower(v_user_email)
      AND engagement_status IN ('notification_sent', 'contacted')
      AND counterparty_org_id IS NULL
    RETURNING *
  LOOP
    v_linked_count := v_linked_count + 1;

    -- Fill the vacant buyer/seller slot on the linked match.
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

      -- Dispatch welcome email (best-effort, never raises)
      IF v_service_key IS NOT NULL THEN
        BEGIN
          -- Pull match + initiator details for template
          SELECT m.id, m.commodity, m.buyer_org_id, m.seller_org_id,
                 m.quantity_amount, m.quantity_unit,
                 m.price_amount, m.price_currency,
                 m.org_id AS initiator_org_id
            INTO v_match
          FROM public.matches m
          WHERE m.id = v_eng.match_id;

          IF v_match.id IS NOT NULL THEN
            -- Recipient's side is the side the new org now occupies
            v_recipient_side := CASE
              WHEN v_match.buyer_org_id = v_org_id THEN 'buyer'
              WHEN v_match.seller_org_id = v_org_id THEN 'seller'
              ELSE NULL
            END;

            SELECT name INTO v_initiator_org_name
            FROM public.organizations
            WHERE id = v_match.initiator_org_id
            LIMIT 1;

            v_payload := jsonb_build_object(
              'templateName', 'welcome-linked-counterparty',
              'recipientEmail', v_user_email,
              'idempotencyKey', 'welcome-linked-' || v_eng.id::text,
              'templateData', jsonb_build_object(
                'recipientName', v_user_full_name,
                'commodity', v_match.commodity,
                'initiatorOrgName', v_initiator_org_name,
                'side', v_recipient_side,
                'matchId', v_match.id::text,
                'quantityAmount', CASE WHEN v_match.quantity_amount IS NULL THEN NULL ELSE v_match.quantity_amount::text END,
                'quantityUnit', v_match.quantity_unit,
                'priceAmount', CASE WHEN v_match.price_amount IS NULL THEN NULL ELSE v_match.price_amount::text END,
                'priceCurrency', v_match.price_currency
              )
            );

            PERFORM extensions.net.http_post(
              url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/send-transactional-email',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_service_key
              ),
              body := v_payload
            );
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- Never block the link on email failure
          INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
          VALUES (
            NULL,
            'engagement.welcome_email_dispatch_failed',
            'poi_engagement',
            v_eng.id,
            jsonb_build_object(
              'error', SQLERRM,
              'recipient', v_user_email,
              'match_id', v_eng.match_id
            )
          );
        END;
      END IF;
    END IF;
  END LOOP;

  IF v_linked_count > 0 THEN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      NULL,
      'engagement.auto_linked',
      'profile',
      NEW.id,
      jsonb_build_object(
        'user_email', v_user_email,
        'org_id', v_org_id,
        'linked_engagement_count', v_linked_count,
        'welcome_email_dispatched', v_service_key IS NOT NULL
      )
    );
  END IF;

  RETURN NEW;
END;
$function$;