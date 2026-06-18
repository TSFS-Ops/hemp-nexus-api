-- Batch 9A: Facilitation closure vocabulary alignment.
-- Additive: keep all existing accepted final_outcome values; add three
-- aliases requested in the master spec so closures match the client's
-- closure vocabulary. No existing rows are altered.

ALTER TABLE public.facilitation_cases
  DROP CONSTRAINT IF EXISTS facilitation_cases_final_outcome_check;

ALTER TABLE public.facilitation_cases
  ADD CONSTRAINT facilitation_cases_final_outcome_check
  CHECK (
    final_outcome IS NULL
    OR final_outcome = ANY (ARRAY[
      -- Accepted Batches 1-8 vocabulary (unchanged):
      'converted_to_known_counterparty_poi',
      'linked_to_existing_organisation',
      'new_counterparty_profile_created',
      'more_information_not_provided',
      'counterparty_declined',
      'unable_to_contact',
      'blocked_by_compliance',
      'duplicate_case',
      'cancelled_by_requester',
      'outside_supported_scope',
      'closed_by_admin_decision',
      'no_authority_confirmed',
      -- Batch 9A additions (master spec alignment):
      'no_response',
      'invalid_details',
      'closed_by_admin'
    ])
  );

COMMENT ON CONSTRAINT facilitation_cases_final_outcome_check
  ON public.facilitation_cases
  IS 'Batch 9A: extended outcome vocabulary. Sensitive outcomes (no_response, invalid_details, duplicate_case, unable_to_contact, blocked_by_compliance, more_information_not_provided) require a closing_reason of >= 10 chars — enforced server-side in facilitation-case-admin-action.';