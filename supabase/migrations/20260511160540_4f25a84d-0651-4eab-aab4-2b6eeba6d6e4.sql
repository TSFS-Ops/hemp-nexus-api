ALTER TABLE public.engagement_outreach_logs
  DROP CONSTRAINT engagement_outreach_logs_actor_type_check;

ALTER TABLE public.engagement_outreach_logs
  ADD CONSTRAINT engagement_outreach_logs_actor_type_check
  CHECK (actor_type = ANY (ARRAY[
    'admin'::text,
    'counterparty'::text,
    'system'::text,
    'initiator'::text
  ]));