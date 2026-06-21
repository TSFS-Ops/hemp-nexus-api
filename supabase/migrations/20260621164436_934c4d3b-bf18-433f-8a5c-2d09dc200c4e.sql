
-- Harden registry_claim_interest_events: bound payload size, restrict allowed audit_event_name,
-- and replace permissive WITH CHECK (true) policies on anon + authenticated INSERT.

-- Table-level size constraints (cover all writers, including service_role)
ALTER TABLE public.registry_claim_interest_events
  ADD CONSTRAINT rcie_payload_size_chk
    CHECK (octet_length(payload::text) <= 4096) NOT VALID;
ALTER TABLE public.registry_claim_interest_events VALIDATE CONSTRAINT rcie_payload_size_chk;

ALTER TABLE public.registry_claim_interest_events
  ADD CONSTRAINT rcie_session_token_size_chk
    CHECK (octet_length(session_token) BETWEEN 8 AND 128) NOT VALID;
ALTER TABLE public.registry_claim_interest_events VALIDATE CONSTRAINT rcie_session_token_size_chk;

ALTER TABLE public.registry_claim_interest_events
  ADD CONSTRAINT rcie_company_reference_size_chk
    CHECK (company_reference IS NULL OR octet_length(company_reference) <= 128) NOT VALID;
ALTER TABLE public.registry_claim_interest_events VALIDATE CONSTRAINT rcie_company_reference_size_chk;

ALTER TABLE public.registry_claim_interest_events
  ADD CONSTRAINT rcie_audit_event_name_chk
    CHECK (audit_event_name IN (
      'registry.claim_interest.viewed',
      'registry.claim_interest.started',
      'registry.claim_interest.cta_clicked',
      'registry.claim_interest.dismissed'
    )) NOT VALID;
ALTER TABLE public.registry_claim_interest_events VALIDATE CONSTRAINT rcie_audit_event_name_chk;

-- Replace permissive policies with bounded WITH CHECK
DROP POLICY IF EXISTS rcie_anon_insert ON public.registry_claim_interest_events;
DROP POLICY IF EXISTS rcie_authn_insert ON public.registry_claim_interest_events;

CREATE POLICY rcie_anon_insert
  ON public.registry_claim_interest_events
  FOR INSERT
  TO anon
  WITH CHECK (
    octet_length(payload::text) <= 4096
    AND octet_length(session_token) BETWEEN 8 AND 128
    AND (company_reference IS NULL OR octet_length(company_reference) <= 128)
    AND audit_event_name IN (
      'registry.claim_interest.viewed',
      'registry.claim_interest.started',
      'registry.claim_interest.cta_clicked',
      'registry.claim_interest.dismissed'
    )
  );

CREATE POLICY rcie_authn_insert
  ON public.registry_claim_interest_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    octet_length(payload::text) <= 4096
    AND octet_length(session_token) BETWEEN 8 AND 128
    AND (company_reference IS NULL OR octet_length(company_reference) <= 128)
    AND audit_event_name IN (
      'registry.claim_interest.viewed',
      'registry.claim_interest.started',
      'registry.claim_interest.cta_clicked',
      'registry.claim_interest.dismissed'
    )
  );
