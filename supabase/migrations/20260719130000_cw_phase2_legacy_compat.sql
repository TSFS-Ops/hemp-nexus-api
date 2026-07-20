-- =====================================================================
-- Izenzo Enterprise Compliance Case Management Workbench
-- Phase 2: Legacy migration and compatibility
--
-- Additive-only. Does not alter or remove public.compliance_cases, its
-- CHECK constraint, or any existing reader/writer of that table (the
-- compliance-cases Edge Function and compliance-freshness-guard.ts keep
-- reading/writing the legacy table exactly as before). This migration:
--   1) adds decision_notes/decided_by to cw_cases (already present on
--      the legacy table, missing on the Phase 1 aggregate);
--   2) idempotently backfills those columns onto already-migrated
--      cw_cases rows, filling NULLs only;
--   3) links each legacy-backfilled cw_cases row to its corresponding
--      event_store rows (aggregate_type='compliance_case') so event
--      history is preserved and discoverable from the new aggregate;
--   4) installs a "synchronized legacy reference" compatibility trigger
--      on public.compliance_cases (AFTER INSERT OR UPDATE) so that new
--      legacy writes keep the cw_cases mirror current during the dual-
--      read compatibility period, without ever being able to break the
--      legacy write path itself (see safety note below).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) New columns on cw_cases (nullable; purely additive)
-- ---------------------------------------------------------------------
ALTER TABLE public.cw_cases ADD COLUMN IF NOT EXISTS decision_notes text;
ALTER TABLE public.cw_cases ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 2) Idempotent backfill: only fills currently-NULL columns, so re-
-- running this migration (or a future re-apply in CI) never clobbers
-- a value already set by the sync trigger below.
-- ---------------------------------------------------------------------
UPDATE public.cw_cases nc
SET decision_notes = lc.decision_notes,
    decided_by = CASE
      WHEN lc.decided_by IS NOT NULL
        AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = lc.decided_by)
      THEN lc.decided_by
      ELSE NULL
    END
FROM public.compliance_cases lc
WHERE nc.legacy_case_id = lc.id
  AND nc.decision_notes IS NULL
  AND nc.decided_by IS NULL
  AND (lc.decision_notes IS NOT NULL OR lc.decided_by IS NOT NULL);

-- ---------------------------------------------------------------------
-- 3) Preserve event relationships: link each legacy-backfilled case to
-- its event_store history. Unique constraint on cw_case_related_records
-- (case_id, record_table, record_id) makes this idempotent.
-- ---------------------------------------------------------------------
INSERT INTO public.cw_case_related_records (case_id, record_table, record_id, relationship)
SELECT nc.id, 'event_store', es.id, 'legacy_event'
FROM public.cw_cases nc
JOIN public.event_store es
  ON es.aggregate_type = 'compliance_case'
  AND es.aggregate_id = nc.legacy_case_id
WHERE nc.legacy_case_id IS NOT NULL
ON CONFLICT (case_id, record_table, record_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4) Synchronized legacy reference trigger.
--
-- SAFETY-CRITICAL: this function must NEVER raise an uncaught exception.
-- It fires AFTER INSERT/UPDATE on the *live* compliance_cases table that
-- the compliance-cases Edge Function and compliance-freshness-guard.ts
-- depend on today. An uncaught exception here would roll back the
-- entire transaction, including the legacy write itself. Every failure
-- path is therefore caught and logged to cw_legacy_migration_exceptions
-- instead of propagating. Even the logging insert is wrapped, so a
-- failure to log can never itself break the legacy write.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cw_sync_legacy_compliance_case()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_case_id uuid;
  v_new_status text;
BEGIN
  BEGIN
    v_new_status := CASE NEW.status
      WHEN 'OPEN' THEN 'draft'
      WHEN 'SUBMITTED' THEN 'submitted'
      WHEN 'IN_REVIEW' THEN 'in_review'
      WHEN 'APPROVED' THEN 'approved'
      WHEN 'REJECTED' THEN 'rejected'
      WHEN 'SUSPENDED' THEN 'suspended'
      ELSE 'draft'
    END;

    IF TG_OP = 'INSERT' THEN
      SELECT id INTO v_case_id FROM public.cw_cases WHERE legacy_case_id = NEW.id;
      IF v_case_id IS NULL THEN
        INSERT INTO public.cw_cases (
                  org_id, case_type, status, primary_subject_kind, primary_subject_ref_id,
                  decided_at, decided_by, decision_notes, created_at, legacy_case_id
                ) VALUES (
                  NEW.org_id, 'organisation_onboarding_review', v_new_status, 'entity', NEW.entity_id,
                  NEW.decided_at,
                  CASE WHEN NEW.decided_by IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.decided_by)
                       THEN NEW.decided_by ELSE NULL END,
                  NEW.decision_notes, NEW.created_at, NEW.id
                )
        RETURNING id INTO v_case_id;

        INSERT INTO public.cw_case_subjects (case_id, subject_kind, subject_ref_id, is_primary)
        VALUES (v_case_id, 'entity', NEW.entity_id, true);
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      UPDATE public.cw_cases
      SET status = v_new_status,
          decided_at = NEW.decided_at,
          decided_by = CASE WHEN NEW.decided_by IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = NEW.decided_by)
                            THEN NEW.decided_by ELSE decided_by END,
          decision_notes = COALESCE(NEW.decision_notes, decision_notes)
      WHERE legacy_case_id = NEW.id;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      INSERT INTO public.cw_legacy_migration_exceptions (legacy_case_id, reason, detail)
      VALUES (NEW.id, 'sync_trigger_exception',
            jsonb_build_object('sqlstate', SQLSTATE, 'message', SQLERRM, 'op', TG_OP));
    EXCEPTION WHEN OTHERS THEN
      NULL; -- logging must never be able to break the legacy write either
    END;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cw_sync_legacy_compliance_case_trg ON public.compliance_cases;
CREATE TRIGGER cw_sync_legacy_compliance_case_trg
AFTER INSERT OR UPDATE ON public.compliance_cases
FOR EACH ROW
EXECUTE FUNCTION public.cw_sync_legacy_compliance_case();
