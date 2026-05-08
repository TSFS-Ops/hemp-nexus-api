ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS poi_engagements_counterparty_response_chk;

ALTER TABLE public.poi_engagements
  ADD CONSTRAINT poi_engagements_counterparty_response_chk
  CHECK (
    counterparty_response IS NULL
    OR counterparty_response IN ('accepted','declined','accepted_after_expiry')
  );

COMMENT ON COLUMN public.poi_engagements.counterparty_response IS
  'Batch B: counterparty acceptance response. NULL until counterparty acts. Allowed: accepted, declined, accepted_after_expiry. accepted_after_expiry records that the counterparty acted after the engagement expired — it does NOT revive or progress the engagement; reconfirmation by the initiator is required to create a renewed child engagement.';