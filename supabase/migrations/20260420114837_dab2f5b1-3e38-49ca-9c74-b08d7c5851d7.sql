
-- Add entry_type discriminator
ALTER TABLE public.engagement_outreach_logs
  ADD COLUMN IF NOT EXISTS entry_type text NOT NULL DEFAULT 'contact_attempt';

-- Relax NOT NULL on contact fields (non-contact entries don't have these)
ALTER TABLE public.engagement_outreach_logs
  ALTER COLUMN contact_method DROP NOT NULL,
  ALTER COLUMN contact_detail DROP NOT NULL;

-- Constrain entry_type values
ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT IF EXISTS engagement_outreach_logs_entry_type_check;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_entry_type_check
  CHECK (entry_type IN ('contact_attempt', 'status_change', 'notes_edit', 'email_update', 'system_action'));

-- Enforce: contact_attempt entries MUST have method + detail
ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT IF EXISTS engagement_outreach_logs_contact_required;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_contact_required
  CHECK (
    entry_type <> 'contact_attempt'
    OR (contact_method IS NOT NULL AND contact_detail IS NOT NULL AND length(trim(contact_detail)) > 0)
  );

CREATE INDEX IF NOT EXISTS idx_engagement_outreach_logs_entry_type
  ON public.engagement_outreach_logs (engagement_id, entry_type, created_at DESC);

COMMENT ON COLUMN public.engagement_outreach_logs.entry_type IS
  'Discriminator: contact_attempt (admin reached out), status_change (admin changed status without contact), notes_edit, email_update, system_action (e.g. lifecycle expiry).';
