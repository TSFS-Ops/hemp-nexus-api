
-- ============================================================
-- RBAC Stage 1: Rewrite all RLS policies that reference legacy 'admin'
-- to use the canonical is_admin() helper (which resolves to platform_admin).
-- ============================================================

-- acceptance_receipts
DROP POLICY IF EXISTS "Receipts readable by both parties" ON public.acceptance_receipts;
CREATE POLICY "Receipts readable by both parties" ON public.acceptance_receipts
FOR SELECT USING (
  (initiator_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()))
  OR (counterparty_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()))
  OR public.is_admin(auth.uid())
);

-- admin_audit_logs
DROP POLICY IF EXISTS "Admins can view admin audit logs" ON public.admin_audit_logs;
CREATE POLICY "Admins can view admin audit logs" ON public.admin_audit_logs
FOR SELECT USING (public.is_admin(auth.uid()));

-- admin_risk_items
DROP POLICY IF EXISTS "Admins can manage risk items" ON public.admin_risk_items;
CREATE POLICY "Admins can manage risk items" ON public.admin_risk_items
FOR ALL USING (public.is_admin(auth.uid()));

-- api_keys
DROP POLICY IF EXISTS "Admins can manage all API keys" ON public.api_keys;
CREATE POLICY "Admins can manage all API keys" ON public.api_keys
FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view their own API keys" ON public.api_keys;
CREATE POLICY "Users can view their own API keys" ON public.api_keys
FOR SELECT USING ((created_by = auth.uid()) OR public.is_admin(auth.uid()));

-- api_request_logs
DROP POLICY IF EXISTS "Admins and auditors can view API request logs" ON public.api_request_logs;
CREATE POLICY "Admins and auditors can view API request logs" ON public.api_request_logs
FOR SELECT USING (public.is_admin(auth.uid()) OR public.has_role(auth.uid(), 'auditor'::app_role));

DROP POLICY IF EXISTS "Admins can view all API request logs" ON public.api_request_logs;
CREATE POLICY "Admins can view all API request logs" ON public.api_request_logs
FOR SELECT USING (public.is_admin(auth.uid()));

-- audit_logs
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
CREATE POLICY "Admins can view all audit logs" ON public.audit_logs
FOR SELECT USING (public.is_admin(auth.uid()));

-- behavioral_signals
DROP POLICY IF EXISTS "Admins can view behavioral signals" ON public.behavioral_signals;
CREATE POLICY "Admins can view behavioral signals" ON public.behavioral_signals
FOR SELECT USING (public.is_admin(auth.uid()));

-- brd_change_records
DROP POLICY IF EXISTS "Directors and admins view change records" ON public.brd_change_records;
CREATE POLICY "Directors and admins view change records" ON public.brd_change_records
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'director'::app_role)
  OR public.has_role(auth.uid(), 'auditor'::app_role)
);

-- breaches
DROP POLICY IF EXISTS "Admins view all breaches" ON public.breaches;
CREATE POLICY "Admins view all breaches" ON public.breaches
FOR SELECT USING (public.is_admin(auth.uid()));

-- break_glass_actions
DROP POLICY IF EXISTS "Admins view break-glass actions" ON public.break_glass_actions;
CREATE POLICY "Admins view break-glass actions" ON public.break_glass_actions
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR public.has_role(auth.uid(), 'director'::app_role)
  OR public.has_role(auth.uid(), 'auditor'::app_role)
);

-- clip_on_billing_failures
DROP POLICY IF EXISTS "Admins read clip-on billing failures" ON public.clip_on_billing_failures;
CREATE POLICY "Admins read clip-on billing failures" ON public.clip_on_billing_failures
FOR SELECT USING (public.is_admin(auth.uid()));

-- collapse_ledger
DROP POLICY IF EXISTS "Admins view all collapse records" ON public.collapse_ledger;
CREATE POLICY "Admins view all collapse records" ON public.collapse_ledger
FOR SELECT USING (public.is_admin(auth.uid()));

-- compliance_cases
DROP POLICY IF EXISTS "Admins view all compliance_cases" ON public.compliance_cases;
CREATE POLICY "Admins view all compliance_cases" ON public.compliance_cases
FOR SELECT USING (public.is_admin(auth.uid()));

-- data_source_performance
DROP POLICY IF EXISTS "Admins can manage all performance data" ON public.data_source_performance;
CREATE POLICY "Admins can manage all performance data" ON public.data_source_performance
FOR ALL USING (public.is_admin(auth.uid()));

-- data_source_registrations
DROP POLICY IF EXISTS "Admins can manage all registrations" ON public.data_source_registrations;
CREATE POLICY "Admins can manage all registrations" ON public.data_source_registrations
FOR ALL USING (public.is_admin(auth.uid()));

-- dd_roles
DROP POLICY IF EXISTS "Admins manage all dd_roles" ON public.dd_roles;
CREATE POLICY "Admins manage all dd_roles" ON public.dd_roles
FOR ALL USING (public.is_admin(auth.uid()));

-- discovery_search_logs (collapse redundant platform_admin clause)
DROP POLICY IF EXISTS "Org members can view own search logs" ON public.discovery_search_logs;
CREATE POLICY "Org members can view own search logs" ON public.discovery_search_logs
FOR SELECT USING (
  (org_id IN (SELECT p.org_id FROM profiles p WHERE p.id = auth.uid()))
  OR public.is_admin(auth.uid())
);

-- document_access
DROP POLICY IF EXISTS "Users can revoke access grants they created" ON public.document_access;
CREATE POLICY "Users can revoke access grants they created" ON public.document_access
FOR UPDATE USING ((granted_by_user_id = auth.uid()) OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view access grants for their documents" ON public.document_access;
CREATE POLICY "Users can view access grants for their documents" ON public.document_access
FOR SELECT USING (
  (document_id IN (
    SELECT match_documents.id FROM match_documents
    WHERE (match_documents.uploader_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  ))
  OR (granted_to_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR (granted_to_user_id = auth.uid())
  OR public.is_admin(auth.uid())
);

-- document_access_logs
DROP POLICY IF EXISTS "Admins can view all access logs" ON public.document_access_logs;
CREATE POLICY "Admins can view all access logs" ON public.document_access_logs
FOR SELECT USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can view their own access logs" ON public.document_access_logs;
CREATE POLICY "Users can view their own access logs" ON public.document_access_logs
FOR SELECT USING (
  (accessor_user_id = auth.uid())
  OR (document_id IN (
    SELECT match_documents.id FROM match_documents
    WHERE (match_documents.uploader_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  ))
  OR public.is_admin(auth.uid())
);

-- email_send_log
DROP POLICY IF EXISTS "Platform admins can read send log" ON public.email_send_log;
CREATE POLICY "Platform admins can read send log" ON public.email_send_log
FOR SELECT USING (public.is_admin(auth.uid()));

-- engagement_outreach_logs
DROP POLICY IF EXISTS "Admins can view outreach logs" ON public.engagement_outreach_logs;
CREATE POLICY "Admins can view outreach logs" ON public.engagement_outreach_logs
FOR SELECT USING (public.is_admin(auth.uid()));

-- entities
DROP POLICY IF EXISTS "Admins view all entities" ON public.entities;
CREATE POLICY "Admins view all entities" ON public.entities
FOR SELECT USING (public.is_admin(auth.uid()));

-- event_store
DROP POLICY IF EXISTS "Admins view all event_store" ON public.event_store;
CREATE POLICY "Admins view all event_store" ON public.event_store
FOR SELECT USING (public.is_admin(auth.uid()));

-- governance_doc_registry
DROP POLICY IF EXISTS "Admins manage governance_doc_registry" ON public.governance_doc_registry;
CREATE POLICY "Admins manage governance_doc_registry" ON public.governance_doc_registry
FOR ALL USING (public.is_admin(auth.uid()));

-- invites
DROP POLICY IF EXISTS "Admins can view all invites" ON public.invites;
CREATE POLICY "Admins can view all invites" ON public.invites
FOR SELECT USING (public.is_admin(auth.uid()));

-- jurisdiction_selections
DROP POLICY IF EXISTS "Admins can view all jurisdiction selections" ON public.jurisdiction_selections;
CREATE POLICY "Admins can view all jurisdiction selections" ON public.jurisdiction_selections
FOR SELECT USING (public.is_admin(auth.uid()));

-- licences
DROP POLICY IF EXISTS "Admins can manage all licences" ON public.licences;
CREATE POLICY "Admins can manage all licences" ON public.licences
FOR ALL USING (public.is_admin(auth.uid()));

-- match_analytics
DROP POLICY IF EXISTS "Admins can view all analytics" ON public.match_analytics;
CREATE POLICY "Admins can view all analytics" ON public.match_analytics
FOR SELECT USING (public.is_admin(auth.uid()));

-- match_documents
DROP POLICY IF EXISTS "Document visibility based on ownership and sharing" ON public.match_documents;
CREATE POLICY "Document visibility based on ownership and sharing" ON public.match_documents
FOR SELECT USING (
  (uploader_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR (id IN (
    SELECT document_id FROM document_access
    WHERE (granted_to_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
       OR (granted_to_user_id = auth.uid())
  ))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS "Users can update their own documents" ON public.match_documents;
CREATE POLICY "Users can update their own documents" ON public.match_documents
FOR UPDATE USING (
  (uploader_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR public.is_admin(auth.uid())
);

-- notification_dispatches
DROP POLICY IF EXISTS "Recipients can view their dispatches" ON public.notification_dispatches;
CREATE POLICY "Recipients can view their dispatches" ON public.notification_dispatches
FOR SELECT USING (
  (recipient_user_id = auth.uid())
  OR (recipient_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR public.is_admin(auth.uid())
);

-- organizations
DROP POLICY IF EXISTS "Admins can manage all orgs" ON public.organizations;
CREATE POLICY "Admins can manage all orgs" ON public.organizations
FOR ALL USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Org admins can update their own org" ON public.organizations;
CREATE POLICY "Org admins can update their own org" ON public.organizations
FOR UPDATE USING (
  (id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  AND (public.has_role(auth.uid(), 'org_admin'::app_role) OR public.is_admin(auth.uid()))
);

-- ownership_links
DROP POLICY IF EXISTS "Admins view all ownership_links" ON public.ownership_links;
CREATE POLICY "Admins view all ownership_links" ON public.ownership_links
FOR SELECT USING (public.is_admin(auth.uid()));

-- p3_wads
DROP POLICY IF EXISTS "Admins view all p3_wads" ON public.p3_wads;
CREATE POLICY "Admins view all p3_wads" ON public.p3_wads
FOR SELECT USING (public.is_admin(auth.uid()));

-- poi_events
DROP POLICY IF EXISTS "Admins can view all poi events" ON public.poi_events;
CREATE POLICY "Admins can view all poi events" ON public.poi_events
FOR SELECT USING (public.is_admin(auth.uid()));

-- pois
DROP POLICY IF EXISTS "Admins view all pois" ON public.pois;
CREATE POLICY "Admins view all pois" ON public.pois
FOR SELECT USING (public.is_admin(auth.uid()));

-- rating_appeals
DROP POLICY IF EXISTS "Org admins and platform admins view appeals" ON public.rating_appeals;
CREATE POLICY "Org admins and platform admins view appeals" ON public.rating_appeals
FOR SELECT USING (
  public.is_admin(auth.uid())
  OR (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
      AND public.has_role(auth.uid(), 'org_admin'::app_role))
);

DROP POLICY IF EXISTS "Platform admins resolve appeals" ON public.rating_appeals;
CREATE POLICY "Platform admins resolve appeals" ON public.rating_appeals
FOR UPDATE USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- rating_methodology_versions
DROP POLICY IF EXISTS "Admins view methodology versions" ON public.rating_methodology_versions;
CREATE POLICY "Admins view methodology versions" ON public.rating_methodology_versions
FOR SELECT USING (public.is_admin(auth.uid()));

-- rating_signals
DROP POLICY IF EXISTS "Admins view rating signals" ON public.rating_signals;
CREATE POLICY "Admins view rating signals" ON public.rating_signals
FOR SELECT USING (public.is_admin(auth.uid()));

-- reputation_scores
DROP POLICY IF EXISTS "Admins can view all reputation scores" ON public.reputation_scores;
CREATE POLICY "Admins can view all reputation scores" ON public.reputation_scores
FOR SELECT USING (public.is_admin(auth.uid()));

-- screening_results
DROP POLICY IF EXISTS "Admins view all screenings" ON public.screening_results;
CREATE POLICY "Admins view all screenings" ON public.screening_results
FOR SELECT USING (public.is_admin(auth.uid()));

-- screening_runs
DROP POLICY IF EXISTS "Admins view all screening_runs" ON public.screening_runs;
CREATE POLICY "Admins view all screening_runs" ON public.screening_runs
FOR SELECT USING (public.is_admin(auth.uid()));

-- sdk_examples
DROP POLICY IF EXISTS "Admins can manage SDK examples" ON public.sdk_examples;
CREATE POLICY "Admins can manage SDK examples" ON public.sdk_examples
FOR ALL USING (public.is_admin(auth.uid()));

-- token_balances
DROP POLICY IF EXISTS "Admins can manage all token balances" ON public.token_balances;
CREATE POLICY "Admins can manage all token balances" ON public.token_balances
FOR ALL USING (public.is_admin(auth.uid()));

-- token_ledger
DROP POLICY IF EXISTS "Admins can view all token ledger entries" ON public.token_ledger;
CREATE POLICY "Admins can view all token ledger entries" ON public.token_ledger
FOR SELECT USING (public.is_admin(auth.uid()));

-- trade_requests
DROP POLICY IF EXISTS "Admins can view all trade requests" ON public.trade_requests;
CREATE POLICY "Admins can view all trade requests" ON public.trade_requests
FOR SELECT USING (public.is_admin(auth.uid()));

-- user_roles management policies
DROP POLICY IF EXISTS "Admins can manage all roles" ON public.user_roles;
CREATE POLICY "Admins can manage all roles" ON public.user_roles
FOR ALL USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Only admins can delete roles" ON public.user_roles;
CREATE POLICY "Only admins can delete roles" ON public.user_roles
FOR DELETE USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Only admins can insert roles" ON public.user_roles;
CREATE POLICY "Only admins can insert roles" ON public.user_roles
FOR INSERT WITH CHECK (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "Only admins can update roles" ON public.user_roles;
CREATE POLICY "Only admins can update roles" ON public.user_roles
FOR UPDATE USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));

-- wad_attestations (correct schema: wads has org_id/buyer_org_id/seller_org_id, no match_id)
DROP POLICY IF EXISTS "Attestation visibility for WaD parties" ON public.wad_attestations;
CREATE POLICY "Attestation visibility for WaD parties" ON public.wad_attestations
FOR SELECT USING (
  (wad_id IN (
    SELECT w.id FROM wads w
    WHERE (w.org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
       OR (w.buyer_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
       OR (w.seller_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  ))
  OR public.is_admin(auth.uid())
);

-- wads (correct schema: org_id, buyer_org_id, seller_org_id directly on wads)
DROP POLICY IF EXISTS "POI parties can update WaD" ON public.wads;
CREATE POLICY "POI parties can update WaD" ON public.wads
FOR UPDATE USING (
  (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR (buyer_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR (seller_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR public.is_admin(auth.uid())
);

DROP POLICY IF EXISTS "WaD visibility for POI parties and admin" ON public.wads;
CREATE POLICY "WaD visibility for POI parties and admin" ON public.wads
FOR SELECT USING (
  (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR (buyer_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR (seller_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR public.is_admin(auth.uid())
);

-- webhook_deliveries
DROP POLICY IF EXISTS "Users can view their org's webhook deliveries" ON public.webhook_deliveries;
CREATE POLICY "Users can view their org's webhook deliveries" ON public.webhook_deliveries
FOR SELECT USING (
  (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  OR public.is_admin(auth.uid())
);

-- webhook_endpoints
DROP POLICY IF EXISTS "Admins can select webhook_endpoints" ON public.webhook_endpoints;
CREATE POLICY "Admins can select webhook_endpoints" ON public.webhook_endpoints
FOR SELECT USING (public.is_admin(auth.uid()));

-- ============================================================
-- RBAC Stage 2: Block any new legacy 'admin' role assignment.
-- Verified zero existing rows hold this role.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_legacy_admin_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role::text = 'admin' THEN
    RAISE EXCEPTION 'Legacy admin role is deprecated. Use platform_admin instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_legacy_admin_assignment_trg ON public.user_roles;
CREATE TRIGGER prevent_legacy_admin_assignment_trg
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_legacy_admin_assignment();
