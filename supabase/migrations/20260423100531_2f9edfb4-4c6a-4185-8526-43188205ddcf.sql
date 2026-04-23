-- 1. Backfill attestations for historical receipts ----------------------------
WITH targets AS (
  SELECT ar.id           AS receipt_id,
         ar.match_id,
         ar.engagement_id,
         ar.initiator_org_id,
         ar.counterparty_org_id,
         ar.signed_payload,
         ar.signature_hash,
         ar.accepted_at,
         ar.counterparty_email,
         m.org_id        AS match_org_id
    FROM acceptance_receipts ar
    LEFT JOIN matches m ON m.id = ar.match_id
   WHERE ar.attestation_id IS NULL
), inserted AS (
  INSERT INTO attestations (
    org_id, match_id,
    attester_user_id, attester_role, attester_name,
    attestation_type, attestation_text,
    signature_payload, signature_hash, signed_at,
    metadata
  )
  SELECT
    COALESCE(t.counterparty_org_id, t.match_org_id, t.initiator_org_id),
    t.match_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'system_backfill',
    'System backfill (counterparty identity not captured at time of acceptance)',
    'engagement_acceptance',
    format(
      'System-backfilled attestation for engagement %s. Original acceptance occurred at %s. Counterparty contact: %s.',
      t.engagement_id, t.accepted_at, COALESCE(t.counterparty_email, 'unknown')
    ),
    t.signed_payload,
    t.signature_hash,
    t.accepted_at,
    jsonb_build_object(
      'source', 'cross_consistency_backfill',
      'receipt_id', t.receipt_id,
      'engagement_id', t.engagement_id,
      'is_system_actor', true
    )
  FROM targets t
  WHERE COALESCE(t.counterparty_org_id, t.match_org_id, t.initiator_org_id) IS NOT NULL
  RETURNING id, (metadata->>'receipt_id')::uuid AS receipt_id
)
UPDATE acceptance_receipts ar
   SET attestation_id = i.id,
       metadata = COALESCE(ar.metadata, '{}'::jsonb)
                  || jsonb_build_object('attestation_backfilled_at', now()::text)
  FROM inserted i
 WHERE i.receipt_id = ar.id;

-- 2. Backfill event_store rows for accepted engagements -----------------------
INSERT INTO event_store (
  org_id, domain, aggregate_type, aggregate_id,
  event_type, event_version, occurred_at,
  actor_id, actor_role, payload, event_hash
)
SELECT
  pe.org_id,
  'trade',
  'poi_engagement',
  pe.match_id,
  'engagement.accepted',
  1,
  COALESCE(pe.responded_at, ar.accepted_at, now()),
  ar.accepting_user_id,
  'counterparty',
  jsonb_build_object(
    'engagement_id', pe.id,
    'match_id', pe.match_id,
    'receipt_id', ar.id,
    'attestation_id', ar.attestation_id,
    'signature_hash', ar.signature_hash,
    'counterparty_email', pe.counterparty_email,
    'backfilled', true,
    'occurred_at_source',
      CASE WHEN pe.responded_at IS NOT NULL THEN 'engagement.responded_at'
           WHEN ar.accepted_at IS NOT NULL  THEN 'receipt.accepted_at'
           ELSE 'backfill_now()' END
  ),
  encode(digest(
    pe.id::text || '|' || pe.match_id::text || '|' || ar.signature_hash || '|' ||
    COALESCE(pe.responded_at, ar.accepted_at, now())::text,
    'sha256'
  ), 'hex')
  FROM poi_engagements pe
  JOIN acceptance_receipts ar ON ar.engagement_id = pe.id
 WHERE pe.engagement_status = 'accepted'
   AND NOT EXISTS (
     SELECT 1 FROM event_store es
      WHERE es.aggregate_id = pe.match_id
        AND es.event_type = 'engagement.accepted'
   );

-- 3. Reset rubber-stamped dispatches ------------------------------------------
UPDATE notification_dispatches
   SET status = 'pending',
       delivered_at = NULL,
       error_message = 'reset_for_reverification: prior delivery had null message_id and no email_send_log proof'
 WHERE reference_type = 'acceptance_receipt'
   AND channel = 'email'
   AND status = 'delivered'
   AND message_id IS NULL;

-- 4. Public verification function --------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_acceptance_receipt(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_receipt          RECORD;
  v_attestation      RECORD;
  v_recomputed_hash  text;
  v_dispatches_total int;
  v_dispatches_delivered int;
  v_email_logs       int;
  v_event_present    boolean;
BEGIN
  SELECT * INTO v_receipt FROM acceptance_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  v_recomputed_hash := encode(digest(v_receipt.signed_payload, 'sha256'), 'hex');

  SELECT * INTO v_attestation FROM attestations WHERE id = v_receipt.attestation_id;

  SELECT
    COUNT(*) FILTER (WHERE channel = 'email'),
    COUNT(*) FILTER (WHERE channel = 'email' AND status = 'delivered')
  INTO v_dispatches_total, v_dispatches_delivered
    FROM notification_dispatches
   WHERE reference_id = p_receipt_id AND reference_type = 'acceptance_receipt';

  SELECT COUNT(*) INTO v_email_logs
    FROM notification_dispatches nd
    JOIN email_send_log esl ON esl.message_id = nd.message_id
   WHERE nd.reference_id = p_receipt_id
     AND nd.reference_type = 'acceptance_receipt'
     AND nd.message_id IS NOT NULL;

  SELECT EXISTS (
    SELECT 1 FROM event_store
     WHERE aggregate_id = v_receipt.match_id
       AND event_type = 'engagement.accepted'
  ) INTO v_event_present;

  RETURN jsonb_build_object(
    'found', true,
    'receipt_id', v_receipt.id,
    'match_id', v_receipt.match_id,
    'signature_valid', v_recomputed_hash = v_receipt.signature_hash,
    'stored_hash', v_receipt.signature_hash,
    'recomputed_hash', v_recomputed_hash,
    'attestation_present', v_attestation.id IS NOT NULL,
    'attestation_id', v_receipt.attestation_id,
    'attestation_hash_matches', v_attestation.signature_hash = v_receipt.signature_hash,
    'attestation_is_system_backfill', COALESCE((v_attestation.metadata->>'is_system_actor')::boolean, false),
    'identity_captured', v_receipt.accepting_user_id IS NOT NULL,
    'event_store_present', v_event_present,
    'email_dispatches_total', v_dispatches_total,
    'email_dispatches_delivered', v_dispatches_delivered,
    'email_send_log_proofs', v_email_logs,
    'parity_ok', v_dispatches_delivered = v_email_logs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_acceptance_receipt(uuid) TO authenticated, service_role;