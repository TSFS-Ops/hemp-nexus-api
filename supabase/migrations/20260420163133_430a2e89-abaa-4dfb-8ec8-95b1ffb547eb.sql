-- Guardrail: ensure poi_engagements.expires_at is never less than 24h from creation.
-- Forces a 30-day window if a caller passes NULL or a too-short value, and
-- records the correction in admin_audit_logs for observability.

CREATE OR REPLACE FUNCTION public.enforce_poi_engagement_min_ttl()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_min_ttl interval := interval '24 hours';
  v_default_ttl interval := interval '30 days';
  v_original timestamptz := NEW.expires_at;
  v_created timestamptz := COALESCE(NEW.created_at, now());
BEGIN
  IF NEW.expires_at IS NULL OR NEW.expires_at < v_created + v_min_ttl THEN
    NEW.expires_at := v_created + v_default_ttl;

    -- Audit the correction so we can trace any caller that passes a bad TTL.
    BEGIN
      INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
      VALUES (
        'engagement.expiry_guardrail_applied',
        'poi_engagement',
        NEW.id,
        jsonb_build_object(
          'match_id', NEW.match_id,
          'org_id', NEW.org_id,
          'original_expires_at', v_original,
          'corrected_expires_at', NEW.expires_at,
          'created_at', v_created,
          'reason', CASE
            WHEN v_original IS NULL THEN 'expires_at was NULL'
            ELSE 'expires_at was less than 24h from creation'
          END
        )
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never block the insert because the audit log failed.
      NULL;
    END;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_poi_engagement_min_ttl ON public.poi_engagements;

CREATE TRIGGER trg_enforce_poi_engagement_min_ttl
  BEFORE INSERT ON public.poi_engagements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_poi_engagement_min_ttl();