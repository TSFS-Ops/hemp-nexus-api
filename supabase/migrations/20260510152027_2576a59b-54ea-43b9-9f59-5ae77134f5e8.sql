-- D1.5: schema-only foundation for D2 enforcement. Idempotent.

-- 1. poi_engagements operational_state trio
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS operational_state text,
  ADD COLUMN IF NOT EXISTS operational_state_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS operational_state_set_by uuid;

-- FK: operational_state_set_by -> auth.users(id) ON DELETE SET NULL
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_operational_state_set_by_fk'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_operational_state_set_by_fk
      FOREIGN KEY (operational_state_set_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- CHECK: controlled list for operational_state
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_operational_state_check'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_operational_state_check
      CHECK (operational_state IS NULL OR operational_state = ANY (ARRAY[
        'contact_missing',
        'contact_incomplete',
        'binding_review_required',
        'ready_for_outreach',
        'no_response',
        'bounce_review',
        'late_acceptance_review',
        'disputed_being_named',
        'named_contact_required',
        'suppressed_or_test_review',
        'cancelled_for_email_change'
      ]));
  END IF;
END $$;

-- Indexes for poi_engagements
CREATE INDEX IF NOT EXISTS idx_poi_engagements_operational_state
  ON public.poi_engagements (operational_state, created_at DESC)
  WHERE operational_state IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_poi_engagements_operational_state_set_by
  ON public.poi_engagements (operational_state_set_by)
  WHERE operational_state_set_by IS NOT NULL;

-- 2. matches authorised user fields
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS buyer_authorised_user_id uuid,
  ADD COLUMN IF NOT EXISTS seller_authorised_user_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_buyer_authorised_user_fk'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_buyer_authorised_user_fk
      FOREIGN KEY (buyer_authorised_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matches_seller_authorised_user_fk'
      AND conrelid = 'public.matches'::regclass
  ) THEN
    ALTER TABLE public.matches
      ADD CONSTRAINT matches_seller_authorised_user_fk
      FOREIGN KEY (seller_authorised_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_matches_buyer_authorised_user
  ON public.matches (buyer_authorised_user_id)
  WHERE buyer_authorised_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_matches_seller_authorised_user
  ON public.matches (seller_authorised_user_id)
  WHERE seller_authorised_user_id IS NOT NULL;