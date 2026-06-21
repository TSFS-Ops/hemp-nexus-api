
-- 1) Strict WITH CHECK that mirrors USING. Owners must remain owners.
DROP POLICY IF EXISTS "rbd update own or admin" ON public.registry_bank_detail_submissions;
CREATE POLICY "rbd update own or admin"
ON public.registry_bank_detail_submissions
FOR UPDATE
TO authenticated
USING (
  submitter_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'platform_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_owner'::app_role)
)
WITH CHECK (
  submitter_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'platform_admin'::app_role)
  OR public.has_role(auth.uid(), 'compliance_owner'::app_role)
);

-- 2) Immutable-field + lifecycle-lock trigger for non-admin callers.
CREATE OR REPLACE FUNCTION public.registry_bank_detail_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  is_admin boolean := COALESCE(
    public.has_role(auth.uid(), 'platform_admin'::app_role)
    OR public.has_role(auth.uid(), 'compliance_owner'::app_role),
    false
  );
  draft_states constant text[] := ARRAY['not_provided','draft'];
BEGIN
  -- Admin/compliance always permitted (status mutation is still guarded by
  -- the existing trg_rbd_block_status trigger).
  IF is_admin THEN
    RETURN NEW;
  END IF;

  -- Non-admin owners may never relink ownership, reference, or audit fields.
  IF NEW.submitter_user_id   IS DISTINCT FROM OLD.submitter_user_id   THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: submitter_user_id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.claim_id            IS DISTINCT FROM OLD.claim_id            THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: claim_id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.authority_request_id IS DISTINCT FROM OLD.authority_request_id THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: authority_request_id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.company_reference   IS DISTINCT FROM OLD.company_reference   THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: company_reference is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.company_name        IS DISTINCT FROM OLD.company_name        THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: company_name is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.country_code        IS DISTINCT FROM OLD.country_code        THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: country_code is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.currency_code       IS DISTINCT FROM OLD.currency_code       THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: currency_code is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.created_at          IS DISTINCT FROM OLD.created_at          THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: created_at is immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Verification / approval / dispute audit fields are admin-only.
  IF NEW.verified_at         IS DISTINCT FROM OLD.verified_at
     OR NEW.verified_by      IS DISTINCT FROM OLD.verified_by
     OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
     OR NEW.expiry_at        IS DISTINCT FROM OLD.expiry_at
     OR NEW.revoked_at       IS DISTINCT FROM OLD.revoked_at
     OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason
     OR NEW.disputed_at      IS DISTINCT FROM OLD.disputed_at
     OR NEW.dispute_reason   IS DISTINCT FROM OLD.dispute_reason
     OR NEW.failure_reason   IS DISTINCT FROM OLD.failure_reason
  THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: verification/approval/dispute audit fields are admin-only'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lifecycle lock: once the row leaves draft, only admin/compliance may change it.
  IF NOT (OLD.status = ANY (draft_states)) THEN
    RAISE EXCEPTION 'registry_bank_detail_submissions: row is locked (status=%); only platform_admin or compliance_owner may modify it', OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rbd_guard_update ON public.registry_bank_detail_submissions;
CREATE TRIGGER trg_rbd_guard_update
BEFORE UPDATE ON public.registry_bank_detail_submissions
FOR EACH ROW EXECUTE FUNCTION public.registry_bank_detail_guard_update();
