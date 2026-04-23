CREATE TABLE IF NOT EXISTS public.acceptance_receipt_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES public.acceptance_receipts(id) ON DELETE RESTRICT,
  match_id uuid NOT NULL,
  engagement_id uuid NOT NULL,
  initiator_org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  acknowledging_user_id uuid NOT NULL,
  acknowledging_user_email text,
  acknowledging_user_name text,
  attestation_id uuid REFERENCES public.attestations(id) ON DELETE SET NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  signed_payload text NOT NULL,
  signature_hash text NOT NULL,
  receipt_signature_hash text NOT NULL,
  user_agent text,
  ip_address text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT acceptance_receipt_ack_unique_user UNIQUE (receipt_id, acknowledging_user_id)
);

CREATE INDEX IF NOT EXISTS idx_ack_receipt_id ON public.acceptance_receipt_acknowledgements(receipt_id);
CREATE INDEX IF NOT EXISTS idx_ack_match_id ON public.acceptance_receipt_acknowledgements(match_id);
CREATE INDEX IF NOT EXISTS idx_ack_initiator_org ON public.acceptance_receipt_acknowledgements(initiator_org_id);
CREATE INDEX IF NOT EXISTS idx_ack_attestation ON public.acceptance_receipt_acknowledgements(attestation_id);

ALTER TABLE public.acceptance_receipt_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ack_select_for_match_parties"
ON public.acceptance_receipt_acknowledgements
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.acceptance_receipts r
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE r.id = acceptance_receipt_acknowledgements.receipt_id
      AND p.org_id IN (r.initiator_org_id, r.counterparty_org_id)
  )
  OR public.has_role(auth.uid(), 'platform_admin')
);

CREATE POLICY "ack_insert_initiator_only"
ON public.acceptance_receipt_acknowledgements
FOR INSERT
TO authenticated
WITH CHECK (
  acknowledging_user_id = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.acceptance_receipts r
    JOIN public.profiles p ON p.id = auth.uid()
    WHERE r.id = acceptance_receipt_acknowledgements.receipt_id
      AND p.org_id = r.initiator_org_id
      AND p.org_id = acceptance_receipt_acknowledgements.initiator_org_id
  )
);

-- No UPDATE / DELETE policies => append-only.

CREATE OR REPLACE FUNCTION public.acknowledge_acceptance_receipt(
  p_receipt_id uuid,
  p_user_agent text DEFAULT NULL,
  p_ip_address text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_receipt public.acceptance_receipts%ROWTYPE;
  v_user_email text;
  v_user_name text;
  v_user_org uuid;
  v_existing public.acceptance_receipt_acknowledgements%ROWTYPE;
  v_signed_payload text;
  v_signature_hash text;
  v_attestation_id uuid;
  v_ack_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_receipt FROM public.acceptance_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT org_id, email, COALESCE(full_name, email)
    INTO v_user_org, v_user_email, v_user_name
  FROM public.profiles WHERE id = v_user_id;

  IF v_user_org IS NULL OR v_user_org <> v_receipt.initiator_org_id THEN
    RAISE EXCEPTION 'Only members of the initiator organisation may acknowledge this receipt'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent: if this user already acknowledged, return the existing record
  SELECT * INTO v_existing
  FROM public.acceptance_receipt_acknowledgements
  WHERE receipt_id = p_receipt_id AND acknowledging_user_id = v_user_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'acknowledgement_id', v_existing.id,
      'attestation_id', v_existing.attestation_id,
      'signature_hash', v_existing.signature_hash,
      'acknowledged_at', v_existing.acknowledged_at,
      'already_acknowledged', true
    );
  END IF;

  v_signed_payload := jsonb_build_object(
    'kind', 'receipt_acknowledgement',
    'receipt_id', v_receipt.id,
    'receipt_signature_hash', v_receipt.signature_hash,
    'engagement_id', v_receipt.engagement_id,
    'match_id', v_receipt.match_id,
    'initiator_org_id', v_receipt.initiator_org_id,
    'acknowledging_user_id', v_user_id,
    'acknowledging_user_email', v_user_email,
    'acknowledged_at', now()
  )::text;

  v_signature_hash := encode(extensions.digest(v_signed_payload, 'sha256'), 'hex');

  INSERT INTO public.attestations (
    org_id, match_id, attester_user_id, attester_role, attester_name,
    attestation_type, attestation_text, signature_payload, signature_hash, metadata
  ) VALUES (
    v_receipt.initiator_org_id,
    v_receipt.match_id,
    v_user_id,
    'initiator_operator',
    COALESCE(v_user_name, v_user_email, 'Unknown'),
    'receipt_acknowledged',
    'I confirm that I have personally reviewed the counterparty acceptance receipt and its signed payload.',
    v_signed_payload,
    v_signature_hash,
    jsonb_build_object(
      'receipt_id', v_receipt.id,
      'receipt_signature_hash', v_receipt.signature_hash,
      'user_agent', p_user_agent,
      'ip_address', p_ip_address
    )
  )
  RETURNING id INTO v_attestation_id;

  INSERT INTO public.acceptance_receipt_acknowledgements (
    receipt_id, match_id, engagement_id, initiator_org_id,
    acknowledging_user_id, acknowledging_user_email, acknowledging_user_name,
    attestation_id, signed_payload, signature_hash, receipt_signature_hash,
    user_agent, ip_address
  ) VALUES (
    v_receipt.id, v_receipt.match_id, v_receipt.engagement_id, v_receipt.initiator_org_id,
    v_user_id, v_user_email, v_user_name,
    v_attestation_id, v_signed_payload, v_signature_hash, v_receipt.signature_hash,
    p_user_agent, p_ip_address
  )
  RETURNING id INTO v_ack_id;

  INSERT INTO public.audit_logs (
    org_id, actor_user_id, action, entity_type, entity_id, metadata
  ) VALUES (
    v_receipt.initiator_org_id,
    v_user_id,
    'acceptance_receipt.acknowledged',
    'acceptance_receipt',
    v_receipt.id,
    jsonb_build_object(
      'acknowledgement_id', v_ack_id,
      'attestation_id', v_attestation_id,
      'signature_hash', v_signature_hash,
      'receipt_signature_hash', v_receipt.signature_hash,
      'match_id', v_receipt.match_id
    )
  );

  RETURN jsonb_build_object(
    'acknowledgement_id', v_ack_id,
    'attestation_id', v_attestation_id,
    'signature_hash', v_signature_hash,
    'acknowledged_at', now(),
    'already_acknowledged', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_acceptance_receipt(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.acknowledge_acceptance_receipt(uuid, text, text) TO authenticated;