
-- Batch 3: Align facilitation_cases schema with completed client questionnaire.

-- 1. Add new columns from the questionnaire (all nullable; safe defaults).
ALTER TABLE public.facilitation_cases
  ADD COLUMN IF NOT EXISTS sector text NULL,
  ADD COLUMN IF NOT EXISTS target_response_date date NULL,
  ADD COLUMN IF NOT EXISTS relationship_status text NULL,
  ADD COLUMN IF NOT EXISTS registration_number text NULL,
  ADD COLUMN IF NOT EXISTS tax_vat_number text NULL,
  ADD COLUMN IF NOT EXISTS physical_address text NULL,
  ADD COLUMN IF NOT EXISTS contact_person_title text NULL,
  ADD COLUMN IF NOT EXISTS contact_person_phone text NULL,
  ADD COLUMN IF NOT EXISTS contact_person_email text NULL,
  ADD COLUMN IF NOT EXISTS preferred_contact_language text NULL,
  ADD COLUMN IF NOT EXISTS source_evidence_summary text NULL;

-- 2. Expand role enum to client-approved set.
ALTER TABLE public.facilitation_cases DROP CONSTRAINT IF EXISTS facilitation_cases_role_check;
ALTER TABLE public.facilitation_cases ADD CONSTRAINT facilitation_cases_role_check
  CHECK (role = ANY (ARRAY['buyer','seller','service_provider','funder','other']));

-- 3. Add relationship_status enum check (nullable allowed).
ALTER TABLE public.facilitation_cases DROP CONSTRAINT IF EXISTS facilitation_cases_relationship_status_check;
ALTER TABLE public.facilitation_cases ADD CONSTRAINT facilitation_cases_relationship_status_check
  CHECK (relationship_status IS NULL OR relationship_status = ANY (ARRAY[
    'no_prior_contact','prior_contact','referral','known_but_not_verified'
  ]));

-- 4. Add new internal status `profile_verification_in_progress`.
ALTER TABLE public.facilitation_cases DROP CONSTRAINT IF EXISTS facilitation_cases_internal_status_check;
ALTER TABLE public.facilitation_cases ADD CONSTRAINT facilitation_cases_internal_status_check
  CHECK (internal_status = ANY (ARRAY[
    'new','awaiting_assignment','admin_reviewing','more_information_needed',
    'compliance_review_required','blocked_by_compliance','duplicate_review',
    'ready_for_contact','contact_attempted','awaiting_counterparty_response',
    'counterparty_responded','profile_verification_in_progress',
    'ready_for_known_counterparty_poi','converted_to_known_counterparty_poi',
    'unable_to_proceed','cancelled_by_requester','closed'
  ]));

-- 5. Add `no_authority_confirmed` to outcome set.
ALTER TABLE public.facilitation_cases DROP CONSTRAINT IF EXISTS facilitation_cases_final_outcome_check;
ALTER TABLE public.facilitation_cases ADD CONSTRAINT facilitation_cases_final_outcome_check
  CHECK (final_outcome IS NULL OR final_outcome = ANY (ARRAY[
    'converted_to_known_counterparty_poi','linked_to_existing_organisation',
    'new_counterparty_profile_created','more_information_not_provided',
    'counterparty_declined','unable_to_contact','blocked_by_compliance',
    'duplicate_case','cancelled_by_requester','outside_supported_scope',
    'closed_by_admin_decision','no_authority_confirmed'
  ]));
