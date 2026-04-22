-- One-time historical back-fill of matches whose engagement already knows the counterparty.
DO $$
DECLARE
  r RECORD;
  v_side TEXT;
  v_count INT := 0;
BEGIN
  FOR r IN
    SELECT m.id AS match_id, m.org_id, m.buyer_org_id, m.seller_org_id,
           e.id AS engagement_id, e.counterparty_org_id
      FROM public.matches m
      JOIN public.poi_engagements e ON e.match_id = m.id
     WHERE e.counterparty_org_id IS NOT NULL
       AND (m.buyer_org_id IS NULL OR m.seller_org_id IS NULL)
  LOOP
    v_side := NULL;

    IF r.buyer_org_id = r.org_id AND r.seller_org_id IS NULL THEN
      UPDATE public.matches SET seller_org_id = r.counterparty_org_id WHERE id = r.match_id;
      v_side := 'seller_org_id';
    ELSIF r.seller_org_id = r.org_id AND r.buyer_org_id IS NULL THEN
      UPDATE public.matches SET buyer_org_id = r.counterparty_org_id WHERE id = r.match_id;
      v_side := 'buyer_org_id';
    ELSIF r.buyer_org_id IS NULL AND r.seller_org_id IS NULL THEN
      UPDATE public.matches SET buyer_org_id = r.counterparty_org_id WHERE id = r.match_id;
      v_side := 'buyer_org_id';
    END IF;

    IF v_side IS NOT NULL THEN
      v_count := v_count + 1;
      BEGIN
        INSERT INTO public.audit_logs (org_id, entity_type, entity_id, action, metadata)
        VALUES (
          r.org_id,
          'match',
          r.match_id,
          'match.counterparty_org_backfilled',
          jsonb_build_object(
            'engagement_id', r.engagement_id,
            'side_filled', v_side,
            'counterparty_org_id', r.counterparty_org_id,
            'source', 'historical_backfill_2026_04'
          )
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
  END LOOP;

  RAISE NOTICE 'Back-filled % match rows', v_count;
END$$;