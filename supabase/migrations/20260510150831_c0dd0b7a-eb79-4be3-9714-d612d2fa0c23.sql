-- D1-b: poi_engagements columns, FK, CHECKs, expiry default, and outreach log entry_type expansion
-- Idempotent. No runtime behaviour change beyond new-row default expiry of 7 days.

-- 1. Add 10 nullable columns
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_reason text,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS replacement_engagement_id uuid,
  ADD COLUMN IF NOT EXISTS binding_candidates jsonb,
  ADD COLUMN IF NOT EXISTS binding_resolution text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_by_token_hash text,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS dispute_metadata jsonb;

-- 2. FK on cancelled_by_user_id -> auth.users(id) (idempotent via DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_cancelled_by_user_fk'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_cancelled_by_user_fk
      FOREIGN KEY (cancelled_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Replacement self-FK with ON DELETE RESTRICT ON UPDATE CASCADE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_replacement_fk'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_replacement_fk
      FOREIGN KEY (replacement_engagement_id)
      REFERENCES public.poi_engagements(id)
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- 4. Cancellation required-fields CHECK: if any cancelled_* field is set, all three must be set
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_cancellation_required_fields'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_cancellation_required_fields
      CHECK (
        (cancelled_at IS NULL AND cancelled_reason IS NULL AND cancelled_by_user_id IS NULL)
        OR
        (cancelled_at IS NOT NULL AND cancelled_reason IS NOT NULL AND length(btrim(cancelled_reason)) > 0 AND cancelled_by_user_id IS NOT NULL)
      );
  END IF;
END $$;

-- 5. Dispute required-fields CHECK: if any dispute_* field is set, the core trio must be set
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_dispute_required_fields'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_dispute_required_fields
      CHECK (
        (disputed_at IS NULL AND disputed_by_token_hash IS NULL AND dispute_reason IS NULL)
        OR
        (disputed_at IS NOT NULL AND disputed_by_token_hash IS NOT NULL AND length(btrim(disputed_by_token_hash)) > 0 AND dispute_reason IS NOT NULL AND length(btrim(dispute_reason)) > 0)
      );
  END IF;
END $$;

-- 6. expires_at default -> 7 days (existing rows untouched)
ALTER TABLE public.poi_engagements
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '7 days');

-- 7. Replace engagement_outreach_logs.entry_type CHECK with expanded controlled list
ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT IF EXISTS engagement_outreach_logs_entry_type_check;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'contact_attempt',
    'status_change',
    'notes_edit',
    'email_update',
    'system_action',
    'binding_review_resolved',
    'dispute_raised',
    'dispute_resolved',
    'cancelled',
    'replaced'
  ]));