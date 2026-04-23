-- =============================================================================
-- Automated buyer/seller role-inversion detection
-- =============================================================================
-- Watches inserts/updates of public.matches and writes an admin audit entry
-- whenever the buyer/seller slot assignment contradicts the trade side the
-- creator declared in metadata.tradeSide at creation time.
--
-- Detection rule:
--   creator_org      := NEW.org_id
--   declared_side    := lower(NEW.metadata ->> 'tradeSide')   -- 'buyer'|'seller'
--   IF declared_side = 'buyer'  AND NEW.seller_org_id = creator_org → inversion
--   IF declared_side = 'seller' AND NEW.buyer_org_id  = creator_org → inversion
--   IF declared_side = 'buyer'  AND NEW.buyer_org_id  IS NOT NULL
--                             AND NEW.buyer_org_id  <> creator_org → inversion
--   IF declared_side = 'seller' AND NEW.seller_org_id IS NOT NULL
--                             AND NEW.seller_org_id <> creator_org → inversion
--
-- Observational only — never blocks the write. Writes one audit row per
-- offending insert/update transition.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.detect_match_role_inversion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_declared_side text;
  v_creator_org   uuid;
  v_inversion     boolean := false;
  v_reason        text;
  v_severity      text := 'info';
  v_changed_buyer boolean := false;
  v_changed_seller boolean := false;
BEGIN
  v_creator_org   := NEW.org_id;
  v_declared_side := lower(NULLIF(NEW.metadata ->> 'tradeSide', ''));

  -- Only run if we have something to compare against
  IF v_creator_org IS NULL THEN
    RETURN NEW;
  END IF;

  -- Track which slot(s) changed (for forensic context on UPDATE)
  IF TG_OP = 'UPDATE' THEN
    v_changed_buyer  := COALESCE(NEW.buyer_org_id,  '00000000-0000-0000-0000-000000000000'::uuid)
                      <> COALESCE(OLD.buyer_org_id,  '00000000-0000-0000-0000-000000000000'::uuid);
    v_changed_seller := COALESCE(NEW.seller_org_id, '00000000-0000-0000-0000-000000000000'::uuid)
                      <> COALESCE(OLD.seller_org_id, '00000000-0000-0000-0000-000000000000'::uuid);

    -- If neither slot changed, nothing to detect on UPDATE
    IF NOT v_changed_buyer AND NOT v_changed_seller THEN
      RETURN NEW;
    END IF;
  ELSE
    v_changed_buyer  := NEW.buyer_org_id  IS NOT NULL;
    v_changed_seller := NEW.seller_org_id IS NOT NULL;
  END IF;

  -- Both slots populated and equal → always an inversion / data corruption
  IF NEW.buyer_org_id IS NOT NULL
     AND NEW.seller_org_id IS NOT NULL
     AND NEW.buyer_org_id = NEW.seller_org_id THEN
    v_inversion := true;
    v_severity  := 'error';
    v_reason    := 'buyer_org_id equals seller_org_id (self-trade)';
  END IF;

  -- Declared-side checks
  IF NOT v_inversion AND v_declared_side IS NOT NULL THEN
    IF v_declared_side = 'buyer' THEN
      IF NEW.seller_org_id = v_creator_org THEN
        v_inversion := true;
        v_severity  := 'error';
        v_reason    := 'creator declared tradeSide=buyer but is on seller_org_id slot';
      ELSIF NEW.buyer_org_id IS NOT NULL AND NEW.buyer_org_id <> v_creator_org THEN
        v_inversion := true;
        v_severity  := 'error';
        v_reason    := 'creator declared tradeSide=buyer but a different org occupies buyer_org_id';
      END IF;
    ELSIF v_declared_side = 'seller' THEN
      IF NEW.buyer_org_id = v_creator_org THEN
        v_inversion := true;
        v_severity  := 'error';
        v_reason    := 'creator declared tradeSide=seller but is on buyer_org_id slot';
      ELSIF NEW.seller_org_id IS NOT NULL AND NEW.seller_org_id <> v_creator_org THEN
        v_inversion := true;
        v_severity  := 'error';
        v_reason    := 'creator declared tradeSide=seller but a different org occupies seller_org_id';
      END IF;
    END IF;
  END IF;

  -- No declared side → cannot verify against intent, but we still flag the
  -- self-trade case caught above (severity already set).
  IF v_inversion THEN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      NULL,
      'match.role_inversion_detected',
      'match',
      NEW.id,
      jsonb_build_object(
        'severity', v_severity,
        'reason', v_reason,
        'op', TG_OP,
        'creator_org_id', v_creator_org,
        'declared_side', v_declared_side,
        'buyer_org_id', NEW.buyer_org_id,
        'seller_org_id', NEW.seller_org_id,
        'previous_buyer_org_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.buyer_org_id  ELSE NULL END,
        'previous_seller_org_id', CASE WHEN TG_OP = 'UPDATE' THEN OLD.seller_org_id ELSE NULL END,
        'changed_buyer_slot',  v_changed_buyer,
        'changed_seller_slot', v_changed_seller,
        'match_type', NEW.match_type,
        'state', NEW.state,
        'poi_state', NEW.poi_state,
        'detected_at', now()
      )
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Detection must never block a write. Best-effort logging only.
  BEGIN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      NULL,
      'match.role_inversion_detector_error',
      'match',
      NEW.id,
      jsonb_build_object('error', SQLERRM, 'op', TG_OP)
    );
  EXCEPTION WHEN OTHERS THEN
    -- swallow — never break commercial flow
    NULL;
  END;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_detect_match_role_inversion ON public.matches;

CREATE TRIGGER trg_detect_match_role_inversion
AFTER INSERT OR UPDATE OF buyer_org_id, seller_org_id, metadata, org_id
ON public.matches
FOR EACH ROW
EXECUTE FUNCTION public.detect_match_role_inversion();