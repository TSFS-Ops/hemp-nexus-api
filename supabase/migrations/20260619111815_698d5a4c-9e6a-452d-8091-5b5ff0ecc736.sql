
-- =============================================================
-- Public API V1 · Batch 4 — Sandbox seed records & isolation
-- =============================================================

-- 1. Table
CREATE TABLE public.api_sandbox_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_code text NOT NULL,
  legal_name text,
  trading_name text,
  registration_number text,
  country text,
  website_domain text,
  email_domain text,
  match_status text,
  confidence_band text,
  verification_status text,
  risk_signal_summary text,
  data_freshness_date date,
  record_scope text NOT NULL DEFAULT 'sandbox_only',
  next_action text,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  scenario_notes text,
  test_data boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_sandbox_records_scenario_code_unique UNIQUE (scenario_code),
  CONSTRAINT api_sandbox_records_test_data_true CHECK (test_data = true),
  CONSTRAINT api_sandbox_records_record_scope_check CHECK (record_scope IN ('sandbox_only')),
  CONSTRAINT api_sandbox_records_candidates_limit CHECK (jsonb_array_length(candidates) <= 5)
);

CREATE INDEX idx_api_sandbox_records_scenario_code ON public.api_sandbox_records(scenario_code);
CREATE INDEX idx_api_sandbox_records_active ON public.api_sandbox_records(active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_sandbox_records TO authenticated;
GRANT ALL ON public.api_sandbox_records TO service_role;

ALTER TABLE public.api_sandbox_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platform admins manage api_sandbox_records"
  ON public.api_sandbox_records FOR ALL TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "API admins read api_sandbox_records"
  ON public.api_sandbox_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'api_admin'));

CREATE POLICY "Auditors read api_sandbox_records"
  ON public.api_sandbox_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'auditor'));

CREATE TRIGGER set_api_sandbox_records_updated_at
  BEFORE UPDATE ON public.api_sandbox_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Hard guard — domains must be reserved test domains when set
CREATE OR REPLACE FUNCTION public.api_sandbox_records_enforce_fictional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  allowed_suffixes text[] := ARRAY['example.com','example.test','izenzo.test','sandbox.izenzo.test'];
  d text;
  ok boolean;
BEGIN
  FOREACH d IN ARRAY ARRAY[NEW.website_domain, NEW.email_domain] LOOP
    IF d IS NOT NULL AND length(d) > 0 THEN
      ok := false;
      IF d = ANY(allowed_suffixes) THEN ok := true; END IF;
      IF NOT ok AND (d LIKE '%.example.com' OR d LIKE '%.example.test'
                     OR d LIKE '%.izenzo.test' OR d LIKE '%.sandbox.izenzo.test') THEN
        ok := true;
      END IF;
      IF NOT ok THEN
        RAISE EXCEPTION 'api_sandbox_records: domain % is not a reserved test domain', d
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER api_sandbox_records_fictional_gate
  BEFORE INSERT OR UPDATE ON public.api_sandbox_records
  FOR EACH ROW EXECUTE FUNCTION public.api_sandbox_records_enforce_fictional();

-- Idempotent seed: 16 columns in column-list, 16 values per row.
-- Column order: scenario_code, legal_name, trading_name, registration_number,
-- country, website_domain, email_domain, match_status, confidence_band,
-- verification_status, risk_signal_summary, data_freshness_date,
-- record_scope, next_action, candidates, scenario_notes
INSERT INTO public.api_sandbox_records (
  scenario_code, legal_name, trading_name, registration_number, country,
  website_domain, email_domain, match_status, confidence_band,
  verification_status, risk_signal_summary, data_freshness_date,
  record_scope, next_action, candidates, scenario_notes
) VALUES
  ('verified_match','Acme Test Trading Ltd','Acme Test','TST-0001-VM','GB','acme.example.com','acme.example.com','match','high','verified','No adverse signals in sandbox dataset.','2026-06-01','sandbox_only','Proceed with engagement workflow.','[]'::jsonb,NULL),
  ('unverified_match','Beta Sandbox Holdings','Beta Sandbox','TST-0002-UM','GB','beta.example.com','beta.example.com','match','medium','unverified','Match found but identity not independently verified in sandbox.','2026-05-15','sandbox_only','Collect additional identifiers before relying on this record.','[]'::jsonb,NULL),
  ('no_match',NULL,NULL,NULL,NULL,NULL,NULL,'no_match','none','not_applicable','No matching record found in sandbox dataset.',NULL,'sandbox_only','Provide additional identifiers or escalate to manual review.','[]'::jsonb,'Scenario marker — lookup must return no_match envelope.'),
  ('multiple_possible_matches','Delta Test Group','Delta Test','TST-0004-MM','GB','delta.example.com','delta.example.com','multiple_matches','low','unverified','Multiple candidate records share similar identifiers in sandbox.','2026-04-20','sandbox_only','Disambiguate using registration number or country.','[{"id":"cand-1","legal_name":"Delta Test Group (UK) Ltd","registration_number":"TST-0004-MM-A","country":"GB","confidence_band":"low"},{"id":"cand-2","legal_name":"Delta Test Group (IE) Ltd","registration_number":"TST-0004-MM-B","country":"IE","confidence_band":"low"},{"id":"cand-3","legal_name":"Delta Test Holdings","registration_number":"TST-0004-MM-C","country":"GB","confidence_band":"low"},{"id":"cand-4","legal_name":"Delta Testing Services","registration_number":"TST-0004-MM-D","country":"GB","confidence_band":"low"},{"id":"cand-5","legal_name":"Delta Test International","registration_number":"TST-0004-MM-E","country":"GB","confidence_band":"low"}]'::jsonb,NULL),
  ('blocked_record','Echo Restricted Test Co','Echo Restricted','TST-0005-BL','GB','echo.example.com','echo.example.com','blocked','none','blocked','Record is blocked in sandbox dataset (limited signal only).','2026-06-01','sandbox_only','No further detail available — contact compliance.','[]'::jsonb,NULL),
  ('stale_record','Foxtrot Outdated Test Ltd','Foxtrot Outdated','TST-0006-ST','GB','foxtrot.example.com','foxtrot.example.com','match','low','stale','Sandbox record is older than freshness threshold.','2023-01-10','sandbox_only','Treat as stale — refresh or escalate.','[]'::jsonb,NULL),
  ('unsupported_country','Golf Offworld Test SA',NULL,'TST-0007-UC','ZZ','golf.example.com','golf.example.com','no_match','none','not_applicable','Country ZZ is not supported by the sandbox dataset.',NULL,'sandbox_only','Use a supported country code.','[]'::jsonb,'Scenario marker — endpoint must return unsupported_country.'),
  ('missing_required_field',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Caller must include all required fields.','[]'::jsonb,'Scenario marker — endpoint must return missing_required_field.'),
  ('invalid_api_key',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Use a valid sandbox API key.','[]'::jsonb,'Scenario marker — endpoint must return invalid_api_key.'),
  ('expired_api_key',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Rotate the sandbox API key.','[]'::jsonb,'Scenario marker — endpoint must return expired_api_key.'),
  ('insufficient_scope',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Request the required scope during onboarding.','[]'::jsonb,'Scenario marker — endpoint must return insufficient_scope.'),
  ('sandbox_only_record','Hotel Sandbox Only Test Ltd','Hotel Sandbox','TST-0012-SO','GB','hotel.sandbox.izenzo.test','hotel.sandbox.izenzo.test','match','high','verified','Record exists only in sandbox — must not be returned to production keys.','2026-06-01','sandbox_only','Available only with sandbox keys.','[]'::jsonb,NULL),
  ('production_access_required',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Upgrade to production access to retrieve real records.','[]'::jsonb,'Scenario marker — endpoint must return production_access_required when sandbox key requests production-only behaviour.'),
  ('provider_unavailable',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Retry later — upstream provider is unavailable in this scenario.','[]'::jsonb,'Scenario marker — endpoint must return provider_unavailable.'),
  ('internal_error',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Retry later — sandbox internal_error scenario.','[]'::jsonb,'Scenario marker — endpoint must return internal_error safely without crashing real services.'),
  ('rate_limit_exceeded',NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'sandbox_only','Back off and retry after the rate-limit window.','[]'::jsonb,'Scenario marker — endpoint must return rate_limit_exceeded.')
ON CONFLICT (scenario_code) DO UPDATE SET
  legal_name = EXCLUDED.legal_name,
  trading_name = EXCLUDED.trading_name,
  registration_number = EXCLUDED.registration_number,
  country = EXCLUDED.country,
  website_domain = EXCLUDED.website_domain,
  email_domain = EXCLUDED.email_domain,
  match_status = EXCLUDED.match_status,
  confidence_band = EXCLUDED.confidence_band,
  verification_status = EXCLUDED.verification_status,
  risk_signal_summary = EXCLUDED.risk_signal_summary,
  data_freshness_date = EXCLUDED.data_freshness_date,
  record_scope = EXCLUDED.record_scope,
  next_action = EXCLUDED.next_action,
  candidates = EXCLUDED.candidates,
  scenario_notes = EXCLUDED.scenario_notes,
  active = true,
  updated_at = now();
