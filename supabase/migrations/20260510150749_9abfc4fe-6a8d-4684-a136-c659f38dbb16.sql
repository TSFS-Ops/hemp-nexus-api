-- D1-a: Add engagement_status enum values (idempotent)
ALTER TYPE public.engagement_status ADD VALUE IF NOT EXISTS 'cancelled_email_change';
ALTER TYPE public.engagement_status ADD VALUE IF NOT EXISTS 'disputed_being_named';