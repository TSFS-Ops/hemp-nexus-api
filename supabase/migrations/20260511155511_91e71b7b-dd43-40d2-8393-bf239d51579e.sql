ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT engagement_outreach_logs_entry_type_check;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_entry_type_check
  CHECK (entry_type = ANY (ARRAY[
    'contact_attempt'::text,
    'status_change'::text,
    'notes_edit'::text,
    'email_update'::text,
    'system_action'::text,
    'binding_review_resolved'::text,
    'dispute_raised'::text,
    'dispute_resolved'::text,
    'cancelled'::text,
    'replaced'::text,
    'late_acceptance'::text
  ]));