DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'engagement_status'
      AND e.enumlabel = 'cancelled_by_initiator'
  ) THEN
    ALTER TYPE public.engagement_status ADD VALUE 'cancelled_by_initiator';
  END IF;
END $$;