-- Batch A: contact_type + contact_name on poi_engagements
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS contact_type text NULL,
  ADD COLUMN IF NOT EXISTS contact_name text NULL;

-- Bound contact_type values (nullable allowed; only the two explicit values when set).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'poi_engagements_contact_type_chk'
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_contact_type_chk
      CHECK (contact_type IS NULL OR contact_type IN ('organisation','named_individual'));
  END IF;
END$$;

-- Bound contact_name length (nullable allowed; up to 200 chars when set).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'poi_engagements_contact_name_len_chk'
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_contact_name_len_chk
      CHECK (contact_name IS NULL OR char_length(contact_name) <= 200);
  END IF;
END$$;

-- Partial index supporting the admin "Contact incomplete / Email missing" filter.
CREATE INDEX IF NOT EXISTS idx_poi_engagements_contact_incomplete
  ON public.poi_engagements (created_at DESC)
  WHERE counterparty_email IS NULL OR contact_type IS NULL;

COMMENT ON COLUMN public.poi_engagements.contact_type IS
  'Batch A (06 May 2026): label for the captured counterparty contact. ''organisation'' = organisation-level contact (counterparty_org_id linked OR organisation name on the match). ''named_individual'' = a person; contact_name must be set. NULL = unspecified.';

COMMENT ON COLUMN public.poi_engagements.contact_name IS
  'Batch A (06 May 2026): free-text counterparty contact name (max 200 chars). Used when contact_type = ''named_individual''. Distinct from matches.buyer_name / seller_name which carry the trade-side identity.';