-- DATA-004 Phase 3.1 — operator evidence re-run fixture cleanup.
-- Removes seeded email_send_log rows + retention policies, releases the
-- fixture legal hold with an audited reason. Fixture orgs remain
-- (flagged is_demo=true) because audit_logs immutability prevents cascade.
DELETE FROM public.email_send_log
 WHERE metadata->>'fixture' = 'data-004-phase31-evidence';

DELETE FROM public.org_retention_policies
 WHERE metadata->>'fixture' = 'data-004-phase31-evidence';

UPDATE public.legal_holds
   SET status = 'released',
       released_at = now(),
       released_by = '17265d59-4c25-4422-aa4f-c04c0e84a052',
       released_reason = 'phase 3.1 evidence re-run cleanup'
 WHERE metadata->>'fixture' = 'data-004-phase31-evidence'
   AND status = 'active';