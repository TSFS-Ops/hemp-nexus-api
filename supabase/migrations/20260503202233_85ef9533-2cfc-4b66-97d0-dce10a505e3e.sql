-- D-01 regression cleanup (test-org scoped, idempotent)
DELETE FROM token_ledger
 WHERE org_id = '00000000-0000-0000-0000-00000000d001'
    OR request_id LIKE 'D01-%';

DELETE FROM audit_logs
 WHERE (org_id = '00000000-0000-0000-0000-00000000d001'
        OR metadata->>'payment_reference' LIKE 'D01-%'
        OR metadata->>'reference' LIKE 'D01-%')
   AND action IN (
     'credits.purchase_initiated',
     'credits.purchased',
     'credits.purchase_failed',
     'credits.purchase_rejected'
   );

DELETE FROM admin_risk_items
 WHERE title LIKE 'Paystack settlement mismatch: D01-%'
    OR title LIKE 'Webhook ledger%failure: D01-%';

DELETE FROM webhook_replay_guard
 WHERE source = 'paystack_webhook'
   AND seen_at > now() - interval '1 hour';

UPDATE token_balances
   SET balance = 0, updated_at = now()
 WHERE org_id = '00000000-0000-0000-0000-00000000d001';