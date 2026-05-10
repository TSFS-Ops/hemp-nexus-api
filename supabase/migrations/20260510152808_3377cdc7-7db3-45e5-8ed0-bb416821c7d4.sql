-- D1.6: Allow honest admin-recorded disputes (Option C)
-- Schema-only. Idempotent.

-- 1. Add dispute_source column (nullable) with allowed-values CHECK
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS dispute_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'poi_engagements_dispute_source_check'
      AND conrelid = 'public.poi_engagements'::regclass
  ) THEN
    ALTER TABLE public.poi_engagements
      ADD CONSTRAINT poi_engagements_dispute_source_check
      CHECK (
        dispute_source IS NULL
        OR dispute_source IN ('counterparty_token', 'admin_report')
      );
  END IF;
END $$;

-- 2. Replace dispute_required_fields CHECK with source-aware logic
ALTER TABLE public.poi_engagements
  DROP CONSTRAINT IF EXISTS poi_engagements_dispute_required_fields;

ALTER TABLE public.poi_engagements
  ADD CONSTRAINT poi_engagements_dispute_required_fields
  CHECK (
    -- Branch A: no dispute at all — every dispute field must be NULL.
    (
      disputed_at IS NULL
      AND disputed_by_token_hash IS NULL
      AND dispute_reason IS NULL
      AND dispute_source IS NULL
    )
    OR
    -- Branch B: dispute is recorded — strict integrity rules.
    (
      disputed_at IS NOT NULL
      AND dispute_reason IS NOT NULL
      AND length(btrim(dispute_reason)) > 0
      AND dispute_source IS NOT NULL
      AND dispute_source IN ('counterparty_token', 'admin_report')
      AND (
        -- Token-based dispute: token hash required and non-empty.
        (
          dispute_source = 'counterparty_token'
          AND disputed_by_token_hash IS NOT NULL
          AND length(btrim(disputed_by_token_hash)) > 0
        )
        OR
        -- Admin-recorded dispute: token hash optional (may be NULL or non-empty).
        (
          dispute_source = 'admin_report'
        )
      )
    )
  );

COMMENT ON COLUMN public.poi_engagements.dispute_source IS
  'D1.6: Provenance of the dispute. ''counterparty_token'' = recipient self-disputed via outreach token (token hash required). ''admin_report'' = admin recorded a dispute reported by phone/email (no token hash available).';