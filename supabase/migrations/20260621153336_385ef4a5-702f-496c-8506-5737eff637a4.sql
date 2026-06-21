
-- =========================================================================
-- BATCH 9 — REGISTRY SOURCE IMPORT, FIELD MAPPING, VALIDATION, QUARANTINE
-- =========================================================================

-- 1. Source files ---------------------------------------------------------
CREATE TABLE public.registry_source_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id           UUID REFERENCES public.registry_data_sources(id) ON DELETE SET NULL,
  source_name         TEXT NOT NULL,
  source_type         TEXT NOT NULL CHECK (source_type IN ('manual_records','json_payload','csv_payload','text_extract','pdf_text_paste')),
  source_reference    TEXT,
  storage_url         TEXT,
  country_code        TEXT,
  provider_name       TEXT,
  licence_reference   TEXT,
  permitted_uses      TEXT[] NOT NULL DEFAULT '{}',
  source_generated_date DATE,
  raw_payload         JSONB,
  raw_text            TEXT,
  parsing_status      TEXT NOT NULL DEFAULT 'pending'
                      CHECK (parsing_status IN ('pending','parsed','parse_failed','quarantined')),
  parsing_summary     JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by         UUID REFERENCES auth.users(id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_source_files_country ON public.registry_source_files(country_code);
CREATE INDEX registry_source_files_status  ON public.registry_source_files(parsing_status);

GRANT SELECT ON public.registry_source_files TO authenticated;
GRANT ALL ON public.registry_source_files TO service_role;
ALTER TABLE public.registry_source_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_source_files_read_auth ON public.registry_source_files
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_source_files_write_admin ON public.registry_source_files
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 2. Source file pages ----------------------------------------------------
CREATE TABLE public.registry_source_file_pages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file_id    UUID NOT NULL REFERENCES public.registry_source_files(id) ON DELETE CASCADE,
  page_number       INTEGER NOT NULL,
  page_text         TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_source_file_pages_file ON public.registry_source_file_pages(source_file_id);

GRANT SELECT ON public.registry_source_file_pages TO authenticated;
GRANT ALL ON public.registry_source_file_pages TO service_role;
ALTER TABLE public.registry_source_file_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_source_file_pages_read_auth ON public.registry_source_file_pages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_source_file_pages_write_admin ON public.registry_source_file_pages
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- Link batches to source files (additive column, no FK enforcement to keep flexibility).
ALTER TABLE public.registry_import_batches
  ADD COLUMN IF NOT EXISTS source_file_id UUID REFERENCES public.registry_source_files(id);

-- 3. Field mappings -------------------------------------------------------
CREATE TABLE public.registry_import_field_mappings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      UUID NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  source_field  TEXT NOT NULL,
  target_field  TEXT NOT NULL,
  visibility    TEXT NOT NULL DEFAULT 'public_visible'
                CHECK (visibility IN ('public_searchable','public_visible','masked_public','admin_only','hidden','excluded')),
  notes         TEXT,
  created_by    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, source_field)
);
CREATE INDEX registry_import_field_mappings_batch ON public.registry_import_field_mappings(batch_id);

GRANT SELECT ON public.registry_import_field_mappings TO authenticated;
GRANT ALL ON public.registry_import_field_mappings TO service_role;
ALTER TABLE public.registry_import_field_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_field_mappings_read_auth ON public.registry_import_field_mappings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_field_mappings_write_admin ON public.registry_import_field_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 4. Records staging ------------------------------------------------------
CREATE TABLE public.registry_import_records_staging (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id              UUID NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  batch_row_id          UUID REFERENCES public.registry_import_batch_rows(id) ON DELETE SET NULL,
  row_number            INTEGER NOT NULL,
  country_code          TEXT,
  company_name          TEXT,
  registration_number   TEXT,
  local_number          TEXT,
  vat_number            TEXT,
  legal_form            TEXT,
  company_status        TEXT,
  registered_address    TEXT,
  postal_address        TEXT,
  trading_names         TEXT[] NOT NULL DEFAULT '{}',
  previous_names        TEXT[] NOT NULL DEFAULT '{}',
  source_summary        TEXT,
  source_generated_date DATE,
  activity_summary      TEXT,
  officers              JSONB NOT NULL DEFAULT '[]'::jsonb,
  filings               JSONB NOT NULL DEFAULT '[]'::jsonb,
  events                JSONB NOT NULL DEFAULT '[]'::jsonb,
  contact_email_admin_only TEXT,
  contact_phone_admin_only TEXT,
  raw_extra             JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation_outcome    TEXT NOT NULL DEFAULT 'pending'
                        CHECK (validation_outcome IN ('pending','valid','valid_with_warnings','quarantined','rejected','duplicate_review_required','business_decision_required')),
  quarantine_reason     TEXT,
  duplicate_status      TEXT NOT NULL DEFAULT 'none'
                        CHECK (duplicate_status IN ('none','low','medium','high','exact_identifier_match','reviewed_unique','reviewed_duplicate')),
  publish_status        TEXT NOT NULL DEFAULT 'pending'
                        CHECK (publish_status IN ('pending','skipped','published','failed','blocked')),
  published_record_id   UUID REFERENCES public.registry_company_records(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_import_staging_batch ON public.registry_import_records_staging(batch_id);
CREATE INDEX registry_import_staging_outcome ON public.registry_import_records_staging(validation_outcome);
CREATE INDEX registry_import_staging_publish ON public.registry_import_records_staging(publish_status);

GRANT SELECT ON public.registry_import_records_staging TO authenticated;
GRANT ALL ON public.registry_import_records_staging TO service_role;
ALTER TABLE public.registry_import_records_staging ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_staging_read_auth ON public.registry_import_records_staging
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_staging_write_admin ON public.registry_import_records_staging
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 5. Validation results ---------------------------------------------------
CREATE TABLE public.registry_import_record_validation_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_id    UUID NOT NULL REFERENCES public.registry_import_records_staging(id) ON DELETE CASCADE,
  rule_code     TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warning','error','block')),
  message       TEXT NOT NULL,
  field_name    TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_import_validation_results_staging ON public.registry_import_record_validation_results(staging_id);

GRANT SELECT ON public.registry_import_record_validation_results TO authenticated;
GRANT ALL ON public.registry_import_record_validation_results TO service_role;
ALTER TABLE public.registry_import_record_validation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_validation_results_read_auth ON public.registry_import_record_validation_results
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_validation_results_write_admin ON public.registry_import_record_validation_results
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 6. Duplicate candidates -------------------------------------------------
CREATE TABLE public.registry_import_duplicate_candidates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_id          UUID NOT NULL REFERENCES public.registry_import_records_staging(id) ON DELETE CASCADE,
  candidate_record_id UUID REFERENCES public.registry_company_records(id) ON DELETE SET NULL,
  candidate_staging_id UUID REFERENCES public.registry_import_records_staging(id) ON DELETE SET NULL,
  confidence          TEXT NOT NULL CHECK (confidence IN ('low','medium','high','exact_identifier_match')),
  match_reasons       TEXT[] NOT NULL DEFAULT '{}',
  review_status       TEXT NOT NULL DEFAULT 'pending'
                      CHECK (review_status IN ('pending','reviewed_unique','reviewed_duplicate','reviewed_keep_both')),
  reviewer_id         UUID REFERENCES auth.users(id),
  reviewed_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_import_dupes_staging ON public.registry_import_duplicate_candidates(staging_id);
CREATE INDEX registry_import_dupes_confidence ON public.registry_import_duplicate_candidates(confidence);

GRANT SELECT ON public.registry_import_duplicate_candidates TO authenticated;
GRANT ALL ON public.registry_import_duplicate_candidates TO service_role;
ALTER TABLE public.registry_import_duplicate_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_dupes_read_auth ON public.registry_import_duplicate_candidates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_dupes_write_admin ON public.registry_import_duplicate_candidates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 7. Quarantine queue -----------------------------------------------------
CREATE TABLE public.registry_import_quarantine (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staging_id    UUID NOT NULL REFERENCES public.registry_import_records_staging(id) ON DELETE CASCADE,
  reason_code   TEXT NOT NULL,
  reason_detail TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','released','permanently_excluded')),
  reviewer_id   UUID REFERENCES auth.users(id),
  reviewed_at   TIMESTAMPTZ,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_import_quarantine_staging ON public.registry_import_quarantine(staging_id);
CREATE INDEX registry_import_quarantine_status  ON public.registry_import_quarantine(status);

GRANT SELECT ON public.registry_import_quarantine TO authenticated;
GRANT ALL ON public.registry_import_quarantine TO service_role;
ALTER TABLE public.registry_import_quarantine ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_quarantine_read_auth ON public.registry_import_quarantine
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_quarantine_write_admin ON public.registry_import_quarantine
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 8. Approval events ------------------------------------------------------
CREATE TABLE public.registry_import_approval_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id             UUID NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  decision             TEXT NOT NULL CHECK (decision IN ('approved','rejected','revoked')),
  decided_by           UUID REFERENCES auth.users(id),
  decision_rationale   TEXT NOT NULL,
  evidence_url         TEXT,
  business_decision_id UUID REFERENCES public.business_decisions(id),
  decided_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_import_approval_events_batch ON public.registry_import_approval_events(batch_id);

GRANT SELECT ON public.registry_import_approval_events TO authenticated;
GRANT ALL ON public.registry_import_approval_events TO service_role;
ALTER TABLE public.registry_import_approval_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_approval_events_read_auth ON public.registry_import_approval_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_approval_events_write_admin ON public.registry_import_approval_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- 9. Publish events -------------------------------------------------------
CREATE TABLE public.registry_import_publish_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            UUID NOT NULL REFERENCES public.registry_import_batches(id) ON DELETE CASCADE,
  staging_id          UUID NOT NULL REFERENCES public.registry_import_records_staging(id) ON DELETE CASCADE,
  published_record_id UUID REFERENCES public.registry_company_records(id) ON DELETE SET NULL,
  outcome             TEXT NOT NULL CHECK (outcome IN ('published','skipped','failed','blocked_by_quarantine','blocked_by_duplicate')),
  detail              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_import_publish_events_batch ON public.registry_import_publish_events(batch_id);
CREATE INDEX registry_import_publish_events_outcome ON public.registry_import_publish_events(outcome);

GRANT SELECT ON public.registry_import_publish_events TO authenticated;
GRANT ALL ON public.registry_import_publish_events TO service_role;
ALTER TABLE public.registry_import_publish_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY registry_import_publish_events_read_auth ON public.registry_import_publish_events
  FOR SELECT TO authenticated USING (true);
CREATE POLICY registry_import_publish_events_write_admin ON public.registry_import_publish_events
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'platform_admin'::app_role) OR public.has_role(auth.uid(),'compliance_owner'::app_role));

-- updated_at triggers
CREATE TRIGGER trg_registry_source_files_updated
  BEFORE UPDATE ON public.registry_source_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_registry_import_field_mappings_updated
  BEFORE UPDATE ON public.registry_import_field_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_registry_import_staging_updated
  BEFORE UPDATE ON public.registry_import_records_staging
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_registry_import_quarantine_updated
  BEFORE UPDATE ON public.registry_import_quarantine
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. Atomic publish ------------------------------------------------------
-- Publishes only staging rows that are eligible:
--   - publish_status = 'pending'
--   - validation_outcome IN ('valid','valid_with_warnings')
--   - duplicate_status NOT IN ('high','exact_identifier_match','reviewed_duplicate')
--   - no open quarantine row
-- Every created registry_company_records row is forced to
-- readiness_state = 'imported_unverified' and api_output_allowed = false.
CREATE OR REPLACE FUNCTION public.atomic_publish_registry_import_batch(
  p_batch_id UUID,
  p_actor    UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_batch RECORD;
  v_row   RECORD;
  v_new_id UUID;
  v_published INT := 0;
  v_skipped   INT := 0;
  v_blocked   INT := 0;
  v_indexed   INT := 0;
BEGIN
  -- Caller must be admin / compliance.
  IF NOT (public.has_role(p_actor,'platform_admin'::app_role)
          OR public.has_role(p_actor,'compliance_owner'::app_role)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT id, state, source_id, source_file_id, country_code, licence_reference
    INTO v_batch
    FROM public.registry_import_batches
   WHERE id = p_batch_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'batch_not_found';
  END IF;
  IF v_batch.state <> 'approved' THEN
    RAISE EXCEPTION 'batch_not_approved' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN
    SELECT s.*
      FROM public.registry_import_records_staging s
     WHERE s.batch_id = p_batch_id
       AND s.publish_status = 'pending'
     ORDER BY s.row_number
  LOOP
    -- Quarantine check
    IF EXISTS (SELECT 1 FROM public.registry_import_quarantine q
                WHERE q.staging_id = v_row.id AND q.status = 'open') THEN
      UPDATE public.registry_import_records_staging
         SET publish_status = 'blocked'
       WHERE id = v_row.id;
      INSERT INTO public.registry_import_publish_events
        (batch_id, staging_id, outcome, detail)
      VALUES (p_batch_id, v_row.id, 'blocked_by_quarantine',
              jsonb_build_object('reason', v_row.quarantine_reason));
      v_blocked := v_blocked + 1;
      CONTINUE;
    END IF;

    -- Duplicate block
    IF v_row.duplicate_status IN ('high','exact_identifier_match','reviewed_duplicate') THEN
      UPDATE public.registry_import_records_staging
         SET publish_status = 'blocked'
       WHERE id = v_row.id;
      INSERT INTO public.registry_import_publish_events
        (batch_id, staging_id, outcome, detail)
      VALUES (p_batch_id, v_row.id, 'blocked_by_duplicate',
              jsonb_build_object('duplicate_status', v_row.duplicate_status));
      v_blocked := v_blocked + 1;
      CONTINUE;
    END IF;

    -- Validation gate
    IF v_row.validation_outcome NOT IN ('valid','valid_with_warnings') THEN
      UPDATE public.registry_import_records_staging
         SET publish_status = 'skipped'
       WHERE id = v_row.id;
      INSERT INTO public.registry_import_publish_events
        (batch_id, staging_id, outcome, detail)
      VALUES (p_batch_id, v_row.id, 'skipped',
              jsonb_build_object('validation_outcome', v_row.validation_outcome));
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Create the company record with the conservative readiness default.
    INSERT INTO public.registry_company_records (
      country_code, company_name, registration_number, local_number,
      vat_number, legal_form, company_status, registered_address,
      source_summary, source_generated_date, provenance_reference,
      readiness_state, claim_status, public_display_allowed, api_output_allowed
    ) VALUES (
      COALESCE(v_row.country_code, v_batch.country_code, 'XX'),
      v_row.company_name,
      v_row.registration_number, v_row.local_number, v_row.vat_number,
      v_row.legal_form, v_row.company_status, v_row.registered_address,
      v_row.source_summary,
      COALESCE(v_row.source_generated_date, now()::date),
      'import_batch:' || p_batch_id::text || ':row:' || v_row.row_number::text,
      'imported_unverified', 'unclaimed', true, false
    ) RETURNING id INTO v_new_id;

    -- Identifiers
    IF v_row.registration_number IS NOT NULL THEN
      INSERT INTO public.registry_company_identifiers(record_id, identifier_kind, identifier_value, public_visible)
      VALUES (v_new_id, 'registration_number', v_row.registration_number, true);
    END IF;
    IF v_row.local_number IS NOT NULL THEN
      INSERT INTO public.registry_company_identifiers(record_id, identifier_kind, identifier_value, public_visible)
      VALUES (v_new_id, 'local_number', v_row.local_number, true);
    END IF;
    IF v_row.vat_number IS NOT NULL THEN
      INSERT INTO public.registry_company_identifiers(record_id, identifier_kind, identifier_value, public_visible)
      VALUES (v_new_id, 'vat_number', v_row.vat_number, true);
    END IF;

    -- Addresses
    IF v_row.registered_address IS NOT NULL THEN
      INSERT INTO public.registry_company_addresses(record_id, address_kind, address_text, public_visible)
      VALUES (v_new_id, 'registered', v_row.registered_address, true);
    END IF;
    IF v_row.postal_address IS NOT NULL THEN
      INSERT INTO public.registry_company_addresses(record_id, address_kind, address_text, public_visible)
      VALUES (v_new_id, 'postal', v_row.postal_address, true);
    END IF;

    -- Officers (public name + role only — never personal email/phone)
    IF jsonb_typeof(v_row.officers) = 'array' THEN
      INSERT INTO public.registry_company_people(record_id, role_kind, display_name, public_visible)
      SELECT v_new_id,
             COALESCE(elem->>'role','officer'),
             elem->>'name',
             true
        FROM jsonb_array_elements(v_row.officers) elem
       WHERE (elem->>'name') IS NOT NULL;
    END IF;

    -- Activities
    IF v_row.activity_summary IS NOT NULL THEN
      INSERT INTO public.registry_company_activities(record_id, activity_summary, public_visible)
      VALUES (v_new_id, v_row.activity_summary, true);
    END IF;

    -- Filings/events
    IF jsonb_typeof(v_row.filings) = 'array' THEN
      INSERT INTO public.registry_company_filings(record_id, filing_label, filing_summary, filing_date, public_visible)
      SELECT v_new_id,
             COALESCE(elem->>'label','filing'),
             elem->>'summary',
             NULLIF(elem->>'date','')::date,
             true
        FROM jsonb_array_elements(v_row.filings) elem;
    END IF;
    IF jsonb_typeof(v_row.events) = 'array' THEN
      INSERT INTO public.registry_company_events(record_id, event_label, event_summary, event_date, public_visible)
      SELECT v_new_id,
             COALESCE(elem->>'label','event'),
             elem->>'summary',
             NULLIF(elem->>'date','')::date,
             true
        FROM jsonb_array_elements(v_row.events) elem;
    END IF;

    -- Public search index — only public-safe fields
    INSERT INTO public.registry_company_search_index
      (record_id, tier, field_kind, field_label, value_raw, value_normalised)
    VALUES
      (v_new_id, 'public', 'company_name',         'Company name',         v_row.company_name,         lower(regexp_replace(v_row.company_name,'\s+',' ','g'))),
      (v_new_id, 'public', 'registration_number',  'Registration number',  COALESCE(v_row.registration_number,''), lower(COALESCE(v_row.registration_number,''))),
      (v_new_id, 'public', 'vat_number',           'VAT / tax number',     COALESCE(v_row.vat_number,''),          lower(COALESCE(v_row.vat_number,''))),
      (v_new_id, 'public', 'registered_address',   'Registered address',   COALESCE(v_row.registered_address,''),  lower(COALESCE(v_row.registered_address,'')));
    v_indexed := v_indexed + 4;

    UPDATE public.registry_import_records_staging
       SET publish_status = 'published', published_record_id = v_new_id
     WHERE id = v_row.id;

    INSERT INTO public.registry_import_publish_events
      (batch_id, staging_id, published_record_id, outcome, detail)
    VALUES (p_batch_id, v_row.id, v_new_id, 'published',
            jsonb_build_object('row_number', v_row.row_number));

    INSERT INTO public.event_store(event_name, aggregate_id, aggregate_type, actor_id, payload)
    VALUES ('registry_import_record_published', v_new_id::text, 'registry_company_record', p_actor,
            jsonb_build_object('batch_id', p_batch_id, 'staging_id', v_row.id));

    v_published := v_published + 1;
  END LOOP;

  -- Move batch to published
  UPDATE public.registry_import_batches
     SET state = 'published', published_at = now()
   WHERE id = p_batch_id;

  INSERT INTO public.event_store(event_name, aggregate_id, aggregate_type, actor_id, payload)
  VALUES ('registry_import_publish_completed', p_batch_id::text, 'registry_import_batch', p_actor,
          jsonb_build_object('published', v_published, 'skipped', v_skipped, 'blocked', v_blocked, 'indexed', v_indexed));

  RETURN jsonb_build_object(
    'ok', true,
    'published', v_published,
    'skipped',   v_skipped,
    'blocked',   v_blocked,
    'indexed',   v_indexed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.atomic_publish_registry_import_batch(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.atomic_publish_registry_import_batch(UUID, UUID) TO service_role;
