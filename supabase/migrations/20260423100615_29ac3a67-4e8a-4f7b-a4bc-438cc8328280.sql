CREATE OR REPLACE FUNCTION public.verify_acceptance_receipt(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
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

  v_recomputed_hash := encode(extensions.digest(v_receipt.signed_payload::bytea, 'sha256'), 'hex');

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