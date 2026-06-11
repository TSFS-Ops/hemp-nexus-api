
-- DATA-004 Batch 18 fixture cleanup
DELETE FROM public.email_send_log
WHERE metadata->>'fixture' = 'data-004-batch18-email-purge-positive-control';

UPDATE public.legal_holds
SET status='released',
    released_by='17265d59-4c25-4422-aa4f-c04c0e84a052',
    released_at=now(),
    released_reason='batch18 fixture cleanup — positive-control dry-run evidence captured'
WHERE status='active'
  AND metadata->>'fixture' = 'data-004-batch18-email-purge-positive-control';

DELETE FROM public.org_retention_policies
WHERE record_class='email_send_log'
  AND metadata->>'fixture' = 'data-004-batch18-email-purge-positive-control';
