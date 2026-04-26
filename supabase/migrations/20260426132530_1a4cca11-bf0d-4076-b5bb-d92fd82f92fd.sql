-- R1: Role-of-truth invariant trigger.
-- Blocks two specific corruption shapes observed in production data:
--   1. buyer_org_id = seller_org_id (same org on both sides of a trade)
--   2. creator org_id is set on neither slot when both slots are populated
-- Allows unilateral matches (one or both slots null) so partner-search flows
-- still work while the trigger auto_link_engagement_on_signup fills the slot
-- on counterparty signup.
CREATE OR REPLACE FUNCTION public.matches_role_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Same org on both sides is never legal.
  IF NEW.buyer_org_id IS NOT NULL
     AND NEW.seller_org_id IS NOT NULL
     AND NEW.buyer_org_id = NEW.seller_org_id THEN
    RAISE EXCEPTION
      'matches_role_invariant: buyer_org_id and seller_org_id must differ (got % on both sides)',
      NEW.buyer_org_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- If both slots are filled, the creator must be one of them.
  IF NEW.buyer_org_id IS NOT NULL
     AND NEW.seller_org_id IS NOT NULL
     AND NEW.org_id IS NOT NULL
     AND NEW.org_id <> NEW.buyer_org_id
     AND NEW.org_id <> NEW.seller_org_id THEN
    RAISE EXCEPTION
      'matches_role_invariant: creator org % must be the buyer (%) or seller (%) when both slots are filled',
      NEW.org_id, NEW.buyer_org_id, NEW.seller_org_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS matches_role_invariant_trg ON public.matches;
CREATE TRIGGER matches_role_invariant_trg
  BEFORE INSERT OR UPDATE OF buyer_org_id, seller_org_id, org_id ON public.matches
  FOR EACH ROW
  EXECUTE FUNCTION public.matches_role_invariant();