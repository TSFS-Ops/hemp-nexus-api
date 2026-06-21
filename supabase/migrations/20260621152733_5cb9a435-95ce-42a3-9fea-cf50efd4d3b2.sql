-- Extend Batch 7 webhook event mapping to surface public registry search
-- and public profile view events, so external systems can react without polling.
CREATE OR REPLACE FUNCTION public.batch7_event_name_to_webhook_event(p_event_name TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_event_name
    WHEN 'registry_company_claim_started'        THEN 'claim.evidence_required'
    WHEN 'registry_company_claim_submitted'      THEN 'claim.under_review'
    WHEN 'registry_company_claim_status_changed' THEN 'claim.status_changed'
    WHEN 'registry_company_claim_reviewed'       THEN 'claim.reviewed'
    WHEN 'registry_company_claim_evidence_added' THEN 'claim.evidence_added'
    WHEN 'registry_new_company_request_created'  THEN 'claim.new_company_requested'
    WHEN 'registry_new_company_request_reviewed' THEN 'claim.new_company_reviewed'
    WHEN 'registry_company_correction_request_created'  THEN 'claim.correction_requested'
    WHEN 'registry_company_correction_request_reviewed' THEN 'claim.correction_reviewed'
    WHEN 'registry_claim_conflict_opened'        THEN 'claim.conflict_created'
    WHEN 'registry_claim_conflict_resolved'      THEN 'claim.conflict_resolved'
    WHEN 'registry_outreach_blocked'             THEN 'claim.outreach_blocked'
    -- Batch 8 follow-up: public discovery telemetry as webhook events.
    WHEN 'registry_company_public_search_performed' THEN 'registry.search_performed'
    WHEN 'registry_company_public_profile_viewed'   THEN 'registry.profile_viewed'
    ELSE NULL
  END;
$$;