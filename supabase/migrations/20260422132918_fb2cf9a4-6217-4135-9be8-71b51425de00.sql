-- Trigger: when a POI engagement is bound to a counterparty org, populate
-- the empty side of the parent match (buyer_org_id or seller_org_id) so
-- the recipient's inbound queue surfaces the trade.
--
-- Safe by design:
--  • Only fills NULL sides; never overwrites an existing org_id.
--  • Only fires when counterparty_org_id transitions to non-NULL.
--  • Identifies which side to fill by checking which side already equals
--    the initiator's org (matches.org_id).
--  • Writes an audit_logs row so the back-fill is observable.

CREATE OR REPLACE FUNCTION public.sync_match_counterparty_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match RECORD;
  v_filled_side TEXT;
BEGIN
  -- Only act when counterparty_org_id is being set (insert with value, or
  -- update from NULL to non-NULL, or change between two non-NULL values).
  IF NEW.counterparty_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.counterparty_org_id IS NOT DISTINCT FROM NEW.counterparty_org_id THEN
    RETURN NEW;
  END IF;

  -- Look up the parent match
  SELECT id, org_id, buyer_org_id, seller_org_id
    INTO v_match
    FROM public.matches
   WHERE id = NEW.match_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Determine which side the initiator (match.org_id) sits on, then
  -- fill the OTHER side with the counterparty org — but only if empty.
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

  ELSIF v_match.buyer_org_id IS NULL
        AND v_match.seller_org_id IS NULL THEN
    -- Neither side known yet (rare). Default to filling buyer_org_id —
    -- the initiator side will be reconciled separately when it commits.
    UPDATE public.matches
       SET buyer_org_id = NEW.counterparty_org_id
     WHERE id = v_match.id;
    v_filled_side := 'buyer_org_id';

  ELSE
    -- Both sides already populated, or initiator side is also NULL with
    -- the other already filled. Nothing to do.
    RETURN NEW;
  END IF;

  -- Observability: record the back-fill on the match's org audit log.
  BEGIN
    INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
    VALUES (
      v_match.org_id,
      'match',
      v_match.id,
      'match.counterparty_org_backfilled',
      jsonb_build_object(
        'engagement_id', NEW.id,
        'side_filled', v_filled_side,
        'counterparty_org_id', NEW.counterparty_org_id,
        'source', 'sync_match_counterparty_org_trigger'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Audit failure must never block the back-fill itself.
    NULL;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_match_counterparty_org ON public.poi_engagements;

CREATE TRIGGER trg_sync_match_counterparty_org
AFTER INSERT OR UPDATE OF counterparty_org_id ON public.poi_engagements
FOR EACH ROW
EXECUTE FUNCTION public.sync_match_counterparty_org();