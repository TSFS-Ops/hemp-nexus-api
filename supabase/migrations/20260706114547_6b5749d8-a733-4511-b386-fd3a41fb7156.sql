
-- Guard trigger: registry_authority_requests — block non-admin edits to
-- status/approval/reviewer/sensitivity columns even if the row is owned
-- by the requester. Admin/compliance may still modify these via edge fns.
CREATE OR REPLACE FUNCTION public.registry_authority_requests_guard_non_admin_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_admin boolean := COALESCE(
    public.has_role(auth.uid(),'platform_admin'::app_role)
    OR public.has_role(auth.uid(),'compliance_owner'::app_role),
    false
  );
BEGIN
  IF current_setting('role', true) = 'service_role' OR is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.requester_user_id  IS DISTINCT FROM OLD.requester_user_id  THEN RAISE EXCEPTION 'registry_authority_requests: requester_user_id is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.claim_id           IS DISTINCT FROM OLD.claim_id           THEN RAISE EXCEPTION 'registry_authority_requests: claim_id is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.status             IS DISTINCT FROM OLD.status             THEN RAISE EXCEPTION 'registry_authority_requests: status is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.approved_scope     IS DISTINCT FROM OLD.approved_scope     THEN RAISE EXCEPTION 'registry_authority_requests: approved_scope is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.conditions         IS DISTINCT FROM OLD.conditions         THEN RAISE EXCEPTION 'registry_authority_requests: conditions is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.expiry_at          IS DISTINCT FROM OLD.expiry_at          THEN RAISE EXCEPTION 'registry_authority_requests: expiry_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.revoked_at         IS DISTINCT FROM OLD.revoked_at
     OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason THEN RAISE EXCEPTION 'registry_authority_requests: revocation fields are admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.disputed_at        IS DISTINCT FROM OLD.disputed_at
     OR NEW.dispute_reason  IS DISTINCT FROM OLD.dispute_reason     THEN RAISE EXCEPTION 'registry_authority_requests: dispute fields are admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.reviewer_id        IS DISTINCT FROM OLD.reviewer_id
     OR NEW.reviewed_at     IS DISTINCT FROM OLD.reviewed_at        THEN RAISE EXCEPTION 'registry_authority_requests: reviewer fields are admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.internal_notes     IS DISTINCT FROM OLD.internal_notes     THEN RAISE EXCEPTION 'registry_authority_requests: internal_notes is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.is_sensitive       IS DISTINCT FROM OLD.is_sensitive
     OR NEW.two_person_required IS DISTINCT FROM OLD.two_person_required THEN RAISE EXCEPTION 'registry_authority_requests: sensitivity flags are admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.submitted_at       IS DISTINCT FROM OLD.submitted_at       THEN RAISE EXCEPTION 'registry_authority_requests: submitted_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.escalated_at       IS DISTINCT FROM OLD.escalated_at       THEN RAISE EXCEPTION 'registry_authority_requests: escalated_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.cancelled_at       IS DISTINCT FROM OLD.cancelled_at       THEN RAISE EXCEPTION 'registry_authority_requests: cancelled_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.withdrawn_at       IS DISTINCT FROM OLD.withdrawn_at       THEN RAISE EXCEPTION 'registry_authority_requests: withdrawn_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.created_at         IS DISTINCT FROM OLD.created_at         THEN RAISE EXCEPTION 'registry_authority_requests: created_at is immutable' USING ERRCODE='check_violation'; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ra_requests_guard_non_admin ON public.registry_authority_requests;
CREATE TRIGGER trg_ra_requests_guard_non_admin
  BEFORE UPDATE ON public.registry_authority_requests
  FOR EACH ROW EXECUTE FUNCTION public.registry_authority_requests_guard_non_admin_updates();

-- Guard trigger: registry_company_claims — block non-admin edits to
-- workflow/status/reviewer/approval columns.
CREATE OR REPLACE FUNCTION public.registry_company_claims_guard_non_admin_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_admin boolean := COALESCE(
    public.has_role(auth.uid(),'platform_admin'::app_role)
    OR public.has_role(auth.uid(),'compliance_owner'::app_role),
    false
  );
BEGIN
  IF current_setting('role', true) = 'service_role' OR is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.claimant_user_id           IS DISTINCT FROM OLD.claimant_user_id           THEN RAISE EXCEPTION 'registry_company_claims: claimant_user_id is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.status                     IS DISTINCT FROM OLD.status                     THEN RAISE EXCEPTION 'registry_company_claims: status is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.workflow_status            IS DISTINCT FROM OLD.workflow_status            THEN RAISE EXCEPTION 'registry_company_claims: workflow_status is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.reviewer_id                IS DISTINCT FROM OLD.reviewer_id
     OR NEW.reviewed_at             IS DISTINCT FROM OLD.reviewed_at                THEN RAISE EXCEPTION 'registry_company_claims: reviewer fields are admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.assigned_reviewer_user_id  IS DISTINCT FROM OLD.assigned_reviewer_user_id  THEN RAISE EXCEPTION 'registry_company_claims: assigned_reviewer_user_id is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.internal_notes             IS DISTINCT FROM OLD.internal_notes             THEN RAISE EXCEPTION 'registry_company_claims: internal_notes is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.sla_due_at                 IS DISTINCT FROM OLD.sla_due_at                 THEN RAISE EXCEPTION 'registry_company_claims: sla_due_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.expires_at                 IS DISTINCT FROM OLD.expires_at                 THEN RAISE EXCEPTION 'registry_company_claims: expires_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.rejection_reason           IS DISTINCT FROM OLD.rejection_reason           THEN RAISE EXCEPTION 'registry_company_claims: rejection_reason is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.resubmission_allowed       IS DISTINCT FROM OLD.resubmission_allowed       THEN RAISE EXCEPTION 'registry_company_claims: resubmission_allowed is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.evidence_completeness      IS DISTINCT FROM OLD.evidence_completeness      THEN RAISE EXCEPTION 'registry_company_claims: evidence_completeness is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.conflict_id                IS DISTINCT FROM OLD.conflict_id                THEN RAISE EXCEPTION 'registry_company_claims: conflict_id is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.last_status_change_at      IS DISTINCT FROM OLD.last_status_change_at      THEN RAISE EXCEPTION 'registry_company_claims: last_status_change_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.submitted_at               IS DISTINCT FROM OLD.submitted_at               THEN RAISE EXCEPTION 'registry_company_claims: submitted_at is admin-only' USING ERRCODE='check_violation'; END IF;
  IF NEW.created_at                 IS DISTINCT FROM OLD.created_at                 THEN RAISE EXCEPTION 'registry_company_claims: created_at is immutable' USING ERRCODE='check_violation'; END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registry_company_claims_guard_non_admin ON public.registry_company_claims;
CREATE TRIGGER trg_registry_company_claims_guard_non_admin
  BEFORE UPDATE ON public.registry_company_claims
  FOR EACH ROW EXECUTE FUNCTION public.registry_company_claims_guard_non_admin_updates();

-- Extend existing bank-detail guard to also cover status + failure_reason
-- so that admin/compliance edits via service_role remain allowed but any
-- other authenticated caller is rejected even if a future policy widens
-- the WITH CHECK. (status is also blocked by trg_rbd_block_status.)
CREATE OR REPLACE FUNCTION public.registry_bank_detail_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  is_admin boolean := COALESCE(
    public.has_role(auth.uid(), 'platform_admin'::app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::app_role),
    false
  );
  draft_states constant text[] := ARRAY['not_provided','draft'];
BEGIN
  IF is_admin THEN
    RETURN NEW;
  END IF;

  IF NEW.submitter_user_id   IS DISTINCT FROM OLD.submitter_user_id   THEN RAISE EXCEPTION 'registry_bank_detail_submissions: submitter_user_id is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.claim_id            IS DISTINCT FROM OLD.claim_id            THEN RAISE EXCEPTION 'registry_bank_detail_submissions: claim_id is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.authority_request_id IS DISTINCT FROM OLD.authority_request_id THEN RAISE EXCEPTION 'registry_bank_detail_submissions: authority_request_id is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.company_reference   IS DISTINCT FROM OLD.company_reference   THEN RAISE EXCEPTION 'registry_bank_detail_submissions: company_reference is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.company_name        IS DISTINCT FROM OLD.company_name        THEN RAISE EXCEPTION 'registry_bank_detail_submissions: company_name is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.country_code        IS DISTINCT FROM OLD.country_code        THEN RAISE EXCEPTION 'registry_bank_detail_submissions: country_code is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.currency_code       IS DISTINCT FROM OLD.currency_code       THEN RAISE EXCEPTION 'registry_bank_detail_submissions: currency_code is immutable' USING ERRCODE='check_violation'; END IF;
  IF NEW.created_at          IS DISTINCT FROM OLD.created_at          THEN RAISE EXCEPTION 'registry_bank_detail_submissions: created_at is immutable' USING ERRCODE='check_violation'; END IF;

  IF NEW.status              IS DISTINCT FROM OLD.status
     OR NEW.verified_at         IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by         IS DISTINCT FROM OLD.verified_by
     OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
     OR NEW.expiry_at        IS DISTINCT FROM OLD.expiry_at
     OR NEW.revoked_at       IS DISTINCT FROM OLD.revoked_at
     OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
     OR NEW.disputed_at      IS DISTINCT FROM OLD.disputed_at
     OR NEW.dispute_reason   IS DISTINCT FROM OLD.dispute_reason
     OR NEW.failure_reason   IS DISTINCT FROM OLD.failure_reason
  THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: status / verification / approval / dispute audit fields are admin-only'
      USING ERRCODE='check_violation';
  END IF;

  IF NOT (OLD.status = ANY (draft_states)) THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: row is locked (status=%); only platform_admin or compliance_owner may modify it', OLD.status
      USING ERRCODE='check_violation';
  END IF;

  RETURN NEW;
END;
$$;
