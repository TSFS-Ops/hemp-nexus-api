-- Phase 2 governance taxonomy guard (audit-only, non-blocking).
-- Logs any event_store insert whose event_type is outside the controlled
-- governance taxonomy. The trigger NEVER raises, so legacy writers keep
-- working while we migrate flows to the canonical governance-audit writer.

CREATE TABLE IF NOT EXISTS public.governance_taxonomy_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL,
  org_id uuid NOT NULL,
  event_type text NOT NULL,
  domain text,
  aggregate_type text,
  aggregate_id uuid,
  observed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  payload_keys text[] DEFAULT '{}'::text[]
);

ALTER TABLE public.governance_taxonomy_violations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins view taxonomy violations" ON public.governance_taxonomy_violations;
CREATE POLICY "Admins view taxonomy violations"
  ON public.governance_taxonomy_violations
  FOR SELECT
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Service role manages taxonomy violations" ON public.governance_taxonomy_violations;
CREATE POLICY "Service role manages taxonomy violations"
  ON public.governance_taxonomy_violations
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE INDEX IF NOT EXISTS idx_gov_tax_violations_observed
  ON public.governance_taxonomy_violations (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_tax_violations_event_type
  ON public.governance_taxonomy_violations (event_type, observed_at DESC);

-- Controlled taxonomy (must mirror CONTROLLED_TAXONOMY in
-- supabase/functions/_shared/governance-audit.ts).
CREATE OR REPLACE FUNCTION public.log_event_store_taxonomy_violation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed CONSTANT text[] := ARRAY[
    'poi.created','poi.state_changed','poi.blocked',
    'wad.check_started','wad.check_passed','wad.check_failed',
    'wad.manual_review_required','wad.passed','wad.failed',
    'execution.blocked','execution.permitted',
    'pending_engagement.created','pending_engagement.outreach_sent',
    'pending_engagement.outreach_blocked','pending_engagement.binding_review_required',
    'pending_engagement.late_acceptance_recorded',
    'dispute.opened','dispute.released','dispute.closed',
    'admin.hq_decision_recorded','admin.mfa_required_denied',
    'credit.burn_attempted','credit.burned','credit.burn_blocked',
    'payment.event_created',
    'finality.recorded','memory.record_created',
    'export.governance_record_exported',
    'legal_hold.applied','legal_hold.released',
    'demo.event_recorded','system.audit_writer_health_check'
  ];
  v_critical_prefix CONSTANT text[] := ARRAY[
    'poi.','wad.','execution.','finality.','memory.','credit.',
    'payment.','dispute.','export.'
  ];
  v_event_prefix text;
  v_is_controlled boolean := false;
  v_in_critical_namespace boolean := false;
BEGIN
  -- Only inspect when prefix matches a controlled namespace; legacy
  -- prefixes like 'trade.*' / 'trust.*' / 'core.*' are not flagged.
  SELECT split_part(NEW.event_type, '.', 1) || '.' INTO v_event_prefix;

  v_is_controlled := NEW.event_type = ANY(v_allowed);
  v_in_critical_namespace := v_event_prefix = ANY(v_critical_prefix);

  IF v_in_critical_namespace AND NOT v_is_controlled THEN
    BEGIN
      INSERT INTO public.governance_taxonomy_violations(
        event_id, org_id, event_type, domain, aggregate_type, aggregate_id,
        reason, payload_keys
      ) VALUES (
        NEW.id, NEW.org_id, NEW.event_type, NEW.domain,
        NEW.aggregate_type, NEW.aggregate_id,
        'event_type in critical namespace but not in controlled taxonomy',
        CASE
          WHEN NEW.payload IS NULL THEN '{}'::text[]
          ELSE ARRAY(SELECT jsonb_object_keys(NEW.payload))
        END
      );
    EXCEPTION WHEN OTHERS THEN
      -- Never block the original insert.
      NULL;
    END;
  ELSIF v_in_critical_namespace AND v_is_controlled THEN
    -- Controlled critical event: verify posture_snapshot is present.
    IF NEW.payload IS NULL
       OR NEW.payload -> 'posture_snapshot' IS NULL
       OR (NEW.payload -> 'posture_snapshot' ->> 'verification_posture') IS NULL THEN
      BEGIN
        INSERT INTO public.governance_taxonomy_violations(
          event_id, org_id, event_type, domain, aggregate_type, aggregate_id,
          reason, payload_keys
        ) VALUES (
          NEW.id, NEW.org_id, NEW.event_type, NEW.domain,
          NEW.aggregate_type, NEW.aggregate_id,
          'critical controlled event missing posture_snapshot.verification_posture',
          CASE
            WHEN NEW.payload IS NULL THEN '{}'::text[]
            ELSE ARRAY(SELECT jsonb_object_keys(NEW.payload))
          END
        );
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_event_store_taxonomy_audit ON public.event_store;
CREATE TRIGGER trg_event_store_taxonomy_audit
  AFTER INSERT ON public.event_store
  FOR EACH ROW
  EXECUTE FUNCTION public.log_event_store_taxonomy_violation();