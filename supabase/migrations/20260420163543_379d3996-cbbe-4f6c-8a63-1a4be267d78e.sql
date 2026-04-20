-- Extend the guardrail to UPDATEs as well. The existing function already
-- handles "NULL or sub-24h" correctly; we only need to wire it to UPDATE and
-- compute the floor relative to "now" (not created_at) for an in-life row.

CREATE OR REPLACE FUNCTION public.enforce_poi_engagement_min_ttl_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_min_ttl interval := interval '24 hours';
  v_default_ttl interval := interval '30 days';
  v_original timestamptz := NEW.expires_at;
  v_floor timestamptz := now() + v_min_ttl;
BEGIN
  -- Only act when expires_at actually changes
  IF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    -- Only protect engagements that are still in flight
    IF NEW.engagement_status::text IN ('notification_sent', 'contacted') THEN
      IF NEW.expires_at IS NULL OR NEW.expires_at < v_floor THEN
        NEW.expires_at := now() + v_default_ttl;

        BEGIN
          INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
          VALUES (
            'engagement.expiry_guardrail_applied',
            'poi_engagement',
            NEW.id,
            jsonb_build_object(
              'match_id', NEW.match_id,
              'org_id', NEW.org_id,
              'trigger_op', 'UPDATE',
              'original_expires_at', v_original,
              'corrected_expires_at', NEW.expires_at,
              'engagement_status', NEW.engagement_status,
              'reason', CASE
                WHEN v_original IS NULL THEN 'expires_at was set to NULL on active engagement'
                ELSE 'expires_at update would leave less than 24h on active engagement'
              END
            )
          );
        EXCEPTION WHEN OTHERS THEN
          NULL;
        END;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_poi_engagement_min_ttl_update ON public.poi_engagements;

CREATE TRIGGER trg_enforce_poi_engagement_min_ttl_update
  BEFORE UPDATE OF expires_at ON public.poi_engagements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_poi_engagement_min_ttl_update();