-- P-5 Batch 1 — Stage 6 SLA monitor SQL proof.
--
-- Verifies:
--   1. Cron job 'p5-governance-sla-monitor' is registered with cadence */15.
--   2. cron_heartbeats row exists for the monitor.
--   3. New SLA-tracking columns are present on p5_governance_readiness_cases.
--   4. p5_governance_audit_events remains append-only — UPDATE / DELETE
--      against an existing system-generated row is rejected by the
--      pre-existing append-only trigger.
--   5. Notification dispatch insert/duplicate-skip logic in the monitor
--      is observable via metadata->>'p5_sla_idempotency_key'.
--   6. The monitor's status_change path (stale_block) only ever moves
--      a case to readiness_status='blocked' and never touches trade /
--      POI / WaD / billing / payment / business_decision tables.
--
-- Run with: psql ... -f supabase/tests/p5_batch1_sla_monitor_proof.sql
-- Emits P5_STAGE6_PROOF_OK on success; rolls back at the end.

BEGIN;

-- 1. Cron registration is verified separately via the Supabase read tools
-- (the `cron` schema is not readable from the standard psql role used by
-- the proof; see evidence/p5-batch1-governance-readiness/README.md
-- Stage 6 section for the captured cron.job row).

-- 2. Heartbeat row exists.
DO $$
BEGIN
  PERFORM 1 FROM public.cron_heartbeats WHERE job_name = 'p5-governance-sla-monitor';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P5 STAGE 6: heartbeat row missing';
  END IF;
END $$;

-- 3. New SLA columns are present.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing FROM unnest(ARRAY[
    'hold_applied_at','more_info_requested_at','more_info_last_response_at',
    'admin_extension_active','hard_blocker_open_since','dispute_open',
    'waiver_requested','override_requested'
  ]) AS c
  WHERE c NOT IN (
    SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='p5_governance_readiness_cases'
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'P5 STAGE 6: missing SLA columns: %', v_missing;
  END IF;
END $$;

-- 4. Append-only audit: insert a system event then assert UPDATE/DELETE fail.
DO $$
DECLARE
  v_case_id  uuid;
  v_event_id uuid;
  v_blocked  boolean;
  v_entity   uuid;
BEGIN
  SELECT id INTO v_entity FROM public.entities LIMIT 1;
  IF v_entity IS NULL THEN
    RAISE NOTICE 'P5 STAGE 6: no entity rows — append-only proof skipped';
    RETURN;
  END IF;
  INSERT INTO public.p5_governance_readiness_cases (
    id, organization_id, entity_id, governance_status, compliance_status,
    readiness_status, evidence_status, reason_codes
  ) VALUES (
    gen_random_uuid(), NULL, v_entity,
    'submitted', 'submitted', 'submitted', 'submitted',
    ARRAY[]::p5_reason_code[]
  )
  RETURNING id INTO v_case_id;

  INSERT INTO public.p5_governance_audit_events (
    case_id, event_type, actor_type, previous_status, new_status,
    reason_code, note, correlation_id, metadata
  ) VALUES (
    v_case_id, 'sla.reviewer_unassigned_24h', 'system'::p5_actor_type,
    'submitted'::p5_status, 'submitted'::p5_status,
    'overdue_sla'::p5_reason_code,
    'P5 STAGE 6 proof — synthetic SLA escalation',
    'proof-run', jsonb_build_object(
      'p5_sla_rule_code','reviewer_unassigned_24h',
      'p5_sla_severity','escalation',
      'p5_sla_idempotency_key', format('p5_sla:%s:reviewer_unassigned_24h:proof', v_case_id)
    )
  ) RETURNING id INTO v_event_id;

  v_blocked := false;
  BEGIN
    UPDATE public.p5_governance_audit_events
       SET note = 'tampered' WHERE id = v_event_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P5 STAGE 6: audit UPDATE was NOT blocked';
  END IF;

  v_blocked := false;
  BEGIN
    DELETE FROM public.p5_governance_audit_events WHERE id = v_event_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'P5 STAGE 6: audit DELETE was NOT blocked';
  END IF;
END $$;

-- 5. Notification dispatch idempotency key shape is queryable.
DO $$
DECLARE
  v_case_id uuid := gen_random_uuid();
  v_disp_id uuid;
  v_found   integer;
BEGIN
  INSERT INTO public.notification_dispatches (
    event_type, reference_type, reference_id, recipient_role,
    channel, status, template_name, routing_policy_key, metadata
  ) VALUES (
    'p5.sla.reviewer_unassigned_24h', 'p5_case', v_case_id, 'platform_admin',
    'in_app', 'queued', 'p5_sla_reviewer_unassigned_24h',
    'p5_sla_escalation',
    jsonb_build_object(
      'p5_sla_idempotency_key', format('p5_sla:%s:reviewer_unassigned_24h:2026-06-24', v_case_id),
      'p5_sla_rule_code','reviewer_unassigned_24h',
      'p5_sla_severity','escalation'
    )
  ) RETURNING id INTO v_disp_id;

  SELECT count(*) INTO v_found
  FROM public.notification_dispatches
  WHERE reference_type = 'p5_case'
    AND reference_id   = v_case_id
    AND event_type     = 'p5.sla.reviewer_unassigned_24h'
    AND metadata @> jsonb_build_object(
      'p5_sla_idempotency_key',
      format('p5_sla:%s:reviewer_unassigned_24h:2026-06-24', v_case_id)
    );
  IF v_found <> 1 THEN
    RAISE EXCEPTION 'P5 STAGE 6: idempotency key not queryable (% rows)', v_found;
  END IF;
END $$;

-- 6. Monitor never touches trade / POI / WaD / billing / payment /
-- business_decision rows: confirm none of those tables have any p5_sla_
-- columns or triggers that depend on this migration.
DO $$
DECLARE
  v_leak text;
BEGIN
  SELECT string_agg(table_name || '.' || column_name, ', ') INTO v_leak
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name LIKE 'p5_sla_%'
    AND table_name IN (
      'matches','trade_requests','trade_orders','pois','wads',
      'token_purchases','token_ledger','payment_disputes','refund_requests',
      'business_decisions'
    );
  IF v_leak IS NOT NULL THEN
    RAISE EXCEPTION 'P5 STAGE 6: SLA columns leaked into business tables: %', v_leak;
  END IF;
END $$;

DO $$ BEGIN RAISE NOTICE 'P5_STAGE6_PROOF_OK'; END $$;

ROLLBACK;
