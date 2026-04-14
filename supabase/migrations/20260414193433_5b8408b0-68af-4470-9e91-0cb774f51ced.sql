-- 1. Add structured proof-capture fields to poi_engagements
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS contact_method text,
  ADD COLUMN IF NOT EXISTS contact_date timestamptz;

COMMENT ON COLUMN public.poi_engagements.contact_method IS 'Method of contact used by support (email, phone, in-person, etc.)';
COMMENT ON COLUMN public.poi_engagements.contact_date IS 'Date/time when support contacted the counterparty';

-- 2. Create auto-link function for new registrations
CREATE OR REPLACE FUNCTION public.auto_link_engagement_on_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email text;
  v_org_id uuid;
  v_linked_count int;
BEGIN
  -- Only proceed if org_id is set
  v_org_id := NEW.org_id;
  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get the user's email from auth.users
  SELECT email INTO v_user_email FROM auth.users WHERE id = NEW.id;
  IF v_user_email IS NULL OR v_user_email = '' THEN
    RETURN NEW;
  END IF;

  -- Auto-link any pending engagements where counterparty_email matches
  UPDATE public.poi_engagements
  SET
    counterparty_org_id = v_org_id,
    counterparty_type = 'known'
  WHERE
    lower(counterparty_email) = lower(v_user_email)
    AND engagement_status IN ('notification_sent', 'contacted')
    AND counterparty_org_id IS NULL;

  GET DIAGNOSTICS v_linked_count = ROW_COUNT;

  IF v_linked_count > 0 THEN
    INSERT INTO public.admin_audit_logs (admin_user_id, action, target_type, target_id, details)
    VALUES (
      NULL,
      'engagement.auto_linked',
      'profile',
      NEW.id::text,
      jsonb_build_object(
        'user_email', v_user_email,
        'org_id', v_org_id,
        'linked_engagement_count', v_linked_count
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Create trigger on profiles table
DROP TRIGGER IF EXISTS trg_auto_link_engagement ON public.profiles;
CREATE TRIGGER trg_auto_link_engagement
  AFTER INSERT OR UPDATE OF org_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_link_engagement_on_signup();