
-- ============================================================
-- 1. ACCEPTANCE RECEIPTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.acceptance_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id UUID NOT NULL UNIQUE REFERENCES public.poi_engagements(id) ON DELETE RESTRICT,
  match_id UUID NOT NULL,
  initiator_org_id UUID NOT NULL,
  counterparty_org_id UUID,
  counterparty_email TEXT,
  accepting_user_id UUID,
  accepting_user_name TEXT,
  accepting_user_email TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attestation_id UUID REFERENCES public.attestations(id),
  signed_payload TEXT NOT NULL,
  signature_hash TEXT NOT NULL,
  receipt_version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_acceptance_receipts_match ON public.acceptance_receipts(match_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_receipts_initiator ON public.acceptance_receipts(initiator_org_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_receipts_counterparty ON public.acceptance_receipts(counterparty_org_id);
CREATE INDEX IF NOT EXISTS idx_acceptance_receipts_accepted_at ON public.acceptance_receipts(accepted_at DESC);

ALTER TABLE public.acceptance_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Receipts readable by both parties"
  ON public.acceptance_receipts FOR SELECT
  USING (
    initiator_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    OR counterparty_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
  );

-- No INSERT/UPDATE/DELETE policies — writes only via SECURITY DEFINER function.

-- ============================================================
-- 2. NOTIFICATION DISPATCHES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notification_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  recipient_org_id UUID,
  recipient_user_id UUID,
  recipient_address TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('email','in_app','sms','webhook')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','delivered','opened','failed','suppressed')),
  message_id TEXT,
  template_name TEXT,
  error_message TEXT,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_dispatch_ref ON public.notification_dispatches(reference_type, reference_id);
CREATE INDEX IF NOT EXISTS idx_notif_dispatch_recipient_org ON public.notification_dispatches(recipient_org_id);
CREATE INDEX IF NOT EXISTS idx_notif_dispatch_status ON public.notification_dispatches(status);
CREATE INDEX IF NOT EXISTS idx_notif_dispatch_created ON public.notification_dispatches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_dispatch_event ON public.notification_dispatches(event_type);

ALTER TABLE public.notification_dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Recipients can view their dispatches"
  ON public.notification_dispatches FOR SELECT
  USING (
    recipient_org_id IN (SELECT org_id FROM public.profiles WHERE id = auth.uid())
    OR recipient_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER trg_notification_dispatches_updated_at
  BEFORE UPDATE ON public.notification_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 3. EXTEND atomic_engagement_transition TO EMIT RECEIPT + ATTESTATION + DISPATCHES
-- ============================================================
CREATE OR REPLACE FUNCTION public.atomic_engagement_transition(
  p_engagement_id uuid, p_actor_type text, p_actor_user_id uuid, p_actor_email text,
  p_actor_name text, p_new_status text, p_entry_type text,
  p_contact_method text DEFAULT NULL, p_contact_detail text DEFAULT NULL,
  p_notes text DEFAULT NULL, p_audit_action text DEFAULT NULL, p_audit_org_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_engagement RECORD;
  v_lock_key bigint;
  v_log_id uuid;
  v_prev_status text;
  v_receipt_id uuid;
  v_attestation_id uuid;
  v_signed_payload text;
  v_signature_hash text;
  v_initiator_user_id uuid;
  v_initiator_email text;
  v_dispatch_email_id uuid;
  v_dispatch_inapp_id uuid;
BEGIN
  v_lock_key := ('x' || substr(md5(p_engagement_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_engagement FROM poi_engagements WHERE id = p_engagement_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'NOT_FOUND');
  END IF;

  v_prev_status := v_engagement.engagement_status::text;

  IF v_prev_status = p_new_status THEN
    IF EXISTS (
      SELECT 1 FROM engagement_outreach_logs
      WHERE engagement_id = p_engagement_id
        AND actor_type = p_actor_type
        AND new_status = p_new_status
        AND created_at > now() - interval '5 seconds'
    ) THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'engagement_status', p_new_status);
    END IF;
  END IF;

  UPDATE poi_engagements
  SET engagement_status = p_new_status::engagement_status,
      contacted_at = CASE WHEN p_new_status = 'contacted' AND contacted_at IS NULL THEN now() ELSE contacted_at END,
      responded_at = CASE WHEN p_new_status IN ('accepted','declined') AND responded_at IS NULL THEN now() ELSE responded_at END
  WHERE id = p_engagement_id;

  INSERT INTO engagement_outreach_logs (
    engagement_id, actor_type, admin_user_id, admin_email, admin_name,
    entry_type, contact_method, contact_detail,
    previous_status, new_status, notes
  ) VALUES (
    p_engagement_id, p_actor_type, p_actor_user_id, p_actor_email, p_actor_name,
    p_entry_type, p_contact_method, p_contact_detail,
    v_prev_status, p_new_status, p_notes
  )
  RETURNING id INTO v_log_id;

  IF p_audit_action IS NOT NULL AND p_audit_org_id IS NOT NULL THEN
    IF p_actor_type = 'admin' THEN
      INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, details)
      VALUES (
        p_actor_user_id, p_audit_action, 'poi_engagement', p_engagement_id,
        jsonb_build_object('engagement_id', p_engagement_id, 'previous_status', v_prev_status,
          'new_status', p_new_status, 'outreach_log_id', v_log_id, 'transactional', true)
      );
    ELSE
      INSERT INTO audit_logs (org_id, actor_user_id, action, entity_type, entity_id, metadata)
      VALUES (
        p_audit_org_id, p_actor_user_id, p_audit_action, 'poi_engagement', p_engagement_id,
        jsonb_build_object('engagement_id', p_engagement_id, 'previous_status', v_prev_status,
          'new_status', p_new_status, 'outreach_log_id', v_log_id, 'transactional', true)
      );
    END IF;
  END IF;

  -- ============================================================
  -- ACCEPTANCE RECEIPT BLOCK — only when transitioning INTO 'accepted'
  -- ============================================================
  IF p_new_status = 'accepted' AND v_prev_status <> 'accepted'
     AND NOT EXISTS (SELECT 1 FROM acceptance_receipts WHERE engagement_id = p_engagement_id) THEN

    -- Build canonical signed payload (deterministic JSON)
    v_signed_payload := jsonb_build_object(
      'engagement_id', p_engagement_id,
      'match_id', v_engagement.match_id,
      'initiator_org_id', v_engagement.org_id,
      'counterparty_org_id', v_engagement.counterparty_org_id,
      'counterparty_email', v_engagement.counterparty_email,
      'accepting_user_id', p_actor_user_id,
      'accepting_user_email', p_actor_email,
      'accepting_user_name', p_actor_name,
      'accepted_at', now(),
      'version', 1
    )::text;

    v_signature_hash := encode(digest(v_signed_payload, 'sha256'), 'hex');

    -- Write signed attestation (re-uses existing attestations infrastructure)
    IF p_actor_user_id IS NOT NULL THEN
      INSERT INTO attestations (
        org_id, match_id, attester_user_id, attester_role, attester_name,
        attestation_type, attestation_text, signature_payload, signature_hash, signed_at, metadata
      ) VALUES (
        COALESCE(v_engagement.counterparty_org_id, v_engagement.org_id),
        v_engagement.match_id,
        p_actor_user_id,
        'counterparty_acceptor',
        COALESCE(p_actor_name, p_actor_email, 'Unknown'),
        'engagement_acceptance',
        format('Counterparty %s accepted engagement %s for match %s at %s',
               COALESCE(p_actor_name, p_actor_email), p_engagement_id, v_engagement.match_id, now()),
        v_signed_payload,
        v_signature_hash,
        now(),
        jsonb_build_object('engagement_id', p_engagement_id, 'source', 'atomic_engagement_transition')
      ) RETURNING id INTO v_attestation_id;
    END IF;

    -- Write the immutable acceptance receipt
    INSERT INTO acceptance_receipts (
      engagement_id, match_id, initiator_org_id, counterparty_org_id, counterparty_email,
      accepting_user_id, accepting_user_name, accepting_user_email, accepted_at,
      attestation_id, signed_payload, signature_hash, metadata
    ) VALUES (
      p_engagement_id, v_engagement.match_id, v_engagement.org_id,
      v_engagement.counterparty_org_id, v_engagement.counterparty_email,
      p_actor_user_id, p_actor_name, p_actor_email, now(),
      v_attestation_id, v_signed_payload, v_signature_hash,
      jsonb_build_object('actor_type', p_actor_type, 'outreach_log_id', v_log_id)
    ) RETURNING id INTO v_receipt_id;

    -- Resolve initiator user (org owner/first member) for in-app + email recipient
    SELECT id, email INTO v_initiator_user_id, v_initiator_email
    FROM profiles
    WHERE org_id = v_engagement.org_id
    ORDER BY created_at ASC
    LIMIT 1;

    -- In-app notification for initiator
    IF v_initiator_user_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, org_id, type, title, body, link, read)
      VALUES (
        v_initiator_user_id, v_engagement.org_id, 'engagement_accepted',
        'Counterparty accepted your trade',
        format('%s has accepted your engagement. View the signed receipt and proceed to deal terms.',
               COALESCE(p_actor_name, p_actor_email, 'The counterparty')),
        format('/match/%s?tab=receipt&receipt=%s', v_engagement.match_id, v_receipt_id),
        false
      );
    END IF;

    -- Notification dispatch rows (audit log of every channel attempt)
    INSERT INTO notification_dispatches (
      event_type, reference_type, reference_id, recipient_org_id, recipient_user_id,
      recipient_address, channel, status, template_name, metadata
    ) VALUES (
      'engagement.accepted', 'acceptance_receipt', v_receipt_id,
      v_engagement.org_id, v_initiator_user_id, v_initiator_email,
      'email', 'pending', 'acceptance-receipt', jsonb_build_object('receipt_id', v_receipt_id, 'match_id', v_engagement.match_id)
    ) RETURNING id INTO v_dispatch_email_id;

    INSERT INTO notification_dispatches (
      event_type, reference_type, reference_id, recipient_org_id, recipient_user_id,
      channel, status, dispatched_at, delivered_at, metadata
    ) VALUES (
      'engagement.accepted', 'acceptance_receipt', v_receipt_id,
      v_engagement.org_id, v_initiator_user_id,
      'in_app', 'delivered', now(), now(),
      jsonb_build_object('receipt_id', v_receipt_id, 'match_id', v_engagement.match_id)
    ) RETURNING id INTO v_dispatch_inapp_id;

    RETURN jsonb_build_object('success', true, 'idempotent', false,
      'engagement_id', p_engagement_id, 'previous_status', v_prev_status,
      'new_status', p_new_status, 'outreach_log_id', v_log_id,
      'receipt_id', v_receipt_id, 'attestation_id', v_attestation_id,
      'dispatch_email_id', v_dispatch_email_id, 'dispatch_inapp_id', v_dispatch_inapp_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'idempotent', false,
    'engagement_id', p_engagement_id, 'previous_status', v_prev_status,
    'new_status', p_new_status, 'outreach_log_id', v_log_id);
END;
$function$;

-- ============================================================
-- 4. BACKFILL — historical accepted engagements (e.g. Daniel's platinum trade)
-- ============================================================
DO $$
DECLARE
  r RECORD;
  v_payload text;
  v_hash text;
  v_receipt_id uuid;
  v_initiator_user_id uuid;
  v_initiator_email text;
BEGIN
  FOR r IN
    SELECT pe.* FROM poi_engagements pe
    LEFT JOIN acceptance_receipts ar ON ar.engagement_id = pe.id
    WHERE pe.engagement_status = 'accepted' AND ar.id IS NULL
  LOOP
    v_payload := jsonb_build_object(
      'engagement_id', r.id, 'match_id', r.match_id,
      'initiator_org_id', r.org_id, 'counterparty_org_id', r.counterparty_org_id,
      'counterparty_email', r.counterparty_email,
      'accepted_at', COALESCE(r.responded_at, r.updated_at, r.created_at),
      'version', 1, 'backfilled', true
    )::text;
    v_hash := encode(digest(v_payload, 'sha256'), 'hex');

    INSERT INTO acceptance_receipts (
      engagement_id, match_id, initiator_org_id, counterparty_org_id, counterparty_email,
      accepted_at, signed_payload, signature_hash, metadata
    ) VALUES (
      r.id, r.match_id, r.org_id, r.counterparty_org_id, r.counterparty_email,
      COALESCE(r.responded_at, r.updated_at, r.created_at), v_payload, v_hash,
      jsonb_build_object('backfilled', true, 'backfill_reason', 'historical_acceptance_pre_receipt_system')
    ) RETURNING id INTO v_receipt_id;

    SELECT id, email INTO v_initiator_user_id, v_initiator_email
    FROM profiles WHERE org_id = r.org_id ORDER BY created_at ASC LIMIT 1;

    IF v_initiator_user_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, org_id, type, title, body, link, read)
      VALUES (
        v_initiator_user_id, r.org_id, 'engagement_accepted',
        'Acceptance receipt now available',
        'A signed acceptance receipt has been generated for a previously accepted engagement.',
        format('/match/%s?tab=receipt&receipt=%s', r.match_id, v_receipt_id),
        false
      );

      INSERT INTO notification_dispatches (
        event_type, reference_type, reference_id, recipient_org_id, recipient_user_id,
        recipient_address, channel, status, template_name, metadata
      ) VALUES (
        'engagement.accepted', 'acceptance_receipt', v_receipt_id,
        r.org_id, v_initiator_user_id, v_initiator_email,
        'email', 'pending', 'acceptance-receipt',
        jsonb_build_object('receipt_id', v_receipt_id, 'backfilled', true)
      );

      INSERT INTO notification_dispatches (
        event_type, reference_type, reference_id, recipient_org_id, recipient_user_id,
        channel, status, dispatched_at, delivered_at, metadata
      ) VALUES (
        'engagement.accepted', 'acceptance_receipt', v_receipt_id,
        r.org_id, v_initiator_user_id, 'in_app', 'delivered', now(), now(),
        jsonb_build_object('receipt_id', v_receipt_id, 'backfilled', true)
      );
    END IF;
  END LOOP;
END $$;
