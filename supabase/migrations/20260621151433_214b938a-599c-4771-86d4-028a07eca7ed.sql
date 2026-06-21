
-- Ensure pg_trgm is available before the GIN index.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- 1. registry_company_records
CREATE TABLE public.registry_company_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code TEXT NOT NULL,
  company_name TEXT NOT NULL,
  registration_number TEXT,
  local_number TEXT,
  vat_number TEXT,
  legal_form TEXT,
  company_status TEXT,
  registered_address TEXT,
  source_summary TEXT,
  source_generated_date DATE,
  provenance_reference TEXT,
  readiness_state TEXT NOT NULL DEFAULT 'imported_unverified',
  claim_status TEXT NOT NULL DEFAULT 'unclaimed',
  authority_status_label TEXT NOT NULL DEFAULT 'authority_pending',
  profile_verification_status TEXT NOT NULL DEFAULT 'profile_not_verified',
  bank_detail_status_label TEXT NOT NULL DEFAULT 'bank_details_not_provided',
  public_display_allowed BOOLEAN NOT NULL DEFAULT true,
  api_output_allowed BOOLEAN NOT NULL DEFAULT false,
  claim_allowed BOOLEAN NOT NULL DEFAULT true,
  claim_blocked_reason TEXT,
  internal_confidence_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_records_country ON public.registry_company_records(country_code);
CREATE INDEX registry_company_records_readiness ON public.registry_company_records(readiness_state);
CREATE INDEX registry_company_records_public ON public.registry_company_records(public_display_allowed);

GRANT SELECT ON public.registry_company_records TO anon, authenticated;
GRANT ALL    ON public.registry_company_records TO service_role;
ALTER TABLE public.registry_company_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public records" ON public.registry_company_records FOR SELECT TO anon, authenticated
  USING (public_display_allowed = true);
CREATE POLICY "platform admin reads all records" ON public.registry_company_records FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages records" ON public.registry_company_records FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. identifiers
CREATE TABLE public.registry_company_identifiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  identifier_kind TEXT NOT NULL CHECK (identifier_kind IN
    ('trading_name','previous_name','vat_number','local_number','registration_number','tax_number','other_number')),
  identifier_value TEXT NOT NULL,
  public_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_identifiers_record ON public.registry_company_identifiers(record_id);
GRANT SELECT ON public.registry_company_identifiers TO anon, authenticated;
GRANT ALL ON public.registry_company_identifiers TO service_role;
ALTER TABLE public.registry_company_identifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public identifiers" ON public.registry_company_identifiers FOR SELECT TO anon, authenticated
  USING (public_visible = true AND EXISTS (SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all identifiers" ON public.registry_company_identifiers FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages identifiers" ON public.registry_company_identifiers FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. addresses
CREATE TABLE public.registry_company_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  address_kind TEXT NOT NULL CHECK (address_kind IN ('registered','trading','postal','residential_admin_only')),
  address_text TEXT NOT NULL,
  public_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_addresses_record ON public.registry_company_addresses(record_id);
GRANT SELECT ON public.registry_company_addresses TO anon, authenticated;
GRANT ALL ON public.registry_company_addresses TO service_role;
ALTER TABLE public.registry_company_addresses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public addresses" ON public.registry_company_addresses FOR SELECT TO anon, authenticated
  USING (public_visible = true AND address_kind <> 'residential_admin_only' AND EXISTS (
    SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all addresses" ON public.registry_company_addresses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages addresses" ON public.registry_company_addresses FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. people
CREATE TABLE public.registry_company_people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  role_kind TEXT NOT NULL,
  display_name TEXT,
  full_name TEXT,
  personal_email TEXT,
  personal_phone TEXT,
  personal_address TEXT,
  public_visible BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_people_record ON public.registry_company_people(record_id);
GRANT SELECT (id, record_id, role_kind, display_name, public_visible, created_at) ON public.registry_company_people TO anon, authenticated;
GRANT ALL ON public.registry_company_people TO service_role;
ALTER TABLE public.registry_company_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public people" ON public.registry_company_people FOR SELECT TO anon, authenticated
  USING (public_visible = true AND EXISTS (SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all people" ON public.registry_company_people FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages people" ON public.registry_company_people FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 5. activities
CREATE TABLE public.registry_company_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  activity_summary TEXT NOT NULL,
  public_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_activities_record ON public.registry_company_activities(record_id);
GRANT SELECT ON public.registry_company_activities TO anon, authenticated;
GRANT ALL ON public.registry_company_activities TO service_role;
ALTER TABLE public.registry_company_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public activities" ON public.registry_company_activities FOR SELECT TO anon, authenticated
  USING (public_visible = true AND EXISTS (SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all activities" ON public.registry_company_activities FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages activities" ON public.registry_company_activities FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 6. events
CREATE TABLE public.registry_company_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  event_label TEXT NOT NULL,
  event_summary TEXT,
  event_date DATE,
  raw_text TEXT,
  public_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_events_record ON public.registry_company_events(record_id);
GRANT SELECT (id, record_id, event_label, event_summary, event_date, public_visible, created_at) ON public.registry_company_events TO anon, authenticated;
GRANT ALL ON public.registry_company_events TO service_role;
ALTER TABLE public.registry_company_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public events" ON public.registry_company_events FOR SELECT TO anon, authenticated
  USING (public_visible = true AND EXISTS (SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all events" ON public.registry_company_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages events" ON public.registry_company_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 7. filings
CREATE TABLE public.registry_company_filings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  filing_label TEXT NOT NULL,
  filing_summary TEXT,
  filing_date DATE,
  raw_text TEXT,
  source_document_reference TEXT,
  public_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_filings_record ON public.registry_company_filings(record_id);
GRANT SELECT (id, record_id, filing_label, filing_summary, filing_date, public_visible, created_at) ON public.registry_company_filings TO anon, authenticated;
GRANT ALL ON public.registry_company_filings TO service_role;
ALTER TABLE public.registry_company_filings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public filings" ON public.registry_company_filings FOR SELECT TO anon, authenticated
  USING (public_visible = true AND EXISTS (SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all filings" ON public.registry_company_filings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages filings" ON public.registry_company_filings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 8. search index
CREATE TABLE public.registry_company_search_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID NOT NULL REFERENCES public.registry_company_records(id) ON DELETE CASCADE,
  field_kind TEXT NOT NULL,
  field_label TEXT NOT NULL,
  value_raw TEXT NOT NULL,
  value_normalised TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('public','admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_search_index_record ON public.registry_company_search_index(record_id);
CREATE INDEX registry_company_search_index_value
  ON public.registry_company_search_index USING gin (value_normalised extensions.gin_trgm_ops);
CREATE INDEX registry_company_search_index_tier ON public.registry_company_search_index(tier);

GRANT SELECT ON public.registry_company_search_index TO anon, authenticated;
GRANT ALL ON public.registry_company_search_index TO service_role;
ALTER TABLE public.registry_company_search_index ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public reads public index" ON public.registry_company_search_index FOR SELECT TO anon, authenticated
  USING (tier = 'public' AND EXISTS (SELECT 1 FROM public.registry_company_records r WHERE r.id = record_id AND r.public_display_allowed = true));
CREATE POLICY "platform admin reads all index" ON public.registry_company_search_index FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages index" ON public.registry_company_search_index FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 9. record events
CREATE TABLE public.registry_company_record_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id UUID REFERENCES public.registry_company_records(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  actor_id UUID,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX registry_company_record_events_record ON public.registry_company_record_events(record_id);
CREATE INDEX registry_company_record_events_name   ON public.registry_company_record_events(event_name);
GRANT ALL ON public.registry_company_record_events TO service_role;
ALTER TABLE public.registry_company_record_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform admin reads record events" ON public.registry_company_record_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));
CREATE POLICY "service role manages record events" ON public.registry_company_record_events FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Helpers
CREATE OR REPLACE FUNCTION public.registry_normalise_search_value(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '', 'g');
$$;

CREATE OR REPLACE FUNCTION public.rebuild_registry_company_search_index(p_record_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count INTEGER := 0; v RECORD; rec RECORD;
BEGIN
  DELETE FROM public.registry_company_search_index WHERE record_id = p_record_id;
  SELECT * INTO rec FROM public.registry_company_records WHERE id = p_record_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF rec.company_name IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'company_name', 'Matched on company name', rec.company_name,
      public.registry_normalise_search_value(rec.company_name), 'public');
    v_count := v_count + 1;
  END IF;
  IF rec.registration_number IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES
      (p_record_id, 'registration_number', 'Matched on registration number', rec.registration_number,
        public.registry_normalise_search_value(rec.registration_number), 'public'),
      (p_record_id, 'registration_number', 'Matched on registration number',
        regexp_replace(rec.registration_number, '^[A-Za-z]+[-/ ]?', ''),
        public.registry_normalise_search_value(regexp_replace(rec.registration_number, '^[A-Za-z]+[-/ ]?', '')),
        'public');
    v_count := v_count + 2;
  END IF;
  IF rec.local_number IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'local_number', 'Matched on local number', rec.local_number,
      public.registry_normalise_search_value(rec.local_number), 'public');
    v_count := v_count + 1;
  END IF;
  IF rec.vat_number IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'vat_number', 'Matched on VAT/tax number', rec.vat_number,
      public.registry_normalise_search_value(rec.vat_number), 'public');
    v_count := v_count + 1;
  END IF;
  IF rec.legal_form IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'legal_form', 'Matched on legal form', rec.legal_form,
      public.registry_normalise_search_value(rec.legal_form), 'public');
    v_count := v_count + 1;
  END IF;
  IF rec.country_code IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'country_code', 'Matched on country', rec.country_code,
      public.registry_normalise_search_value(rec.country_code), 'public');
    v_count := v_count + 1;
  END IF;
  IF rec.registered_address IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'registered_address', 'Matched on registered address', rec.registered_address,
      public.registry_normalise_search_value(rec.registered_address), 'public');
    v_count := v_count + 1;
  END IF;

  FOR v IN SELECT * FROM public.registry_company_identifiers WHERE record_id = p_record_id AND public_visible = true LOOP
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, v.identifier_kind, 'Matched on ' || replace(v.identifier_kind, '_', ' '),
            v.identifier_value, public.registry_normalise_search_value(v.identifier_value), 'public');
    v_count := v_count + 1;
  END LOOP;

  FOR v IN SELECT * FROM public.registry_company_addresses WHERE record_id = p_record_id AND public_visible = true AND address_kind <> 'residential_admin_only' LOOP
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'address', 'Matched on ' || v.address_kind || ' address',
            v.address_text, public.registry_normalise_search_value(v.address_text), 'public');
    v_count := v_count + 1;
  END LOOP;

  FOR v IN SELECT * FROM public.registry_company_activities WHERE record_id = p_record_id AND public_visible = true LOOP
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'activity', 'Matched on activity description',
            v.activity_summary, public.registry_normalise_search_value(v.activity_summary), 'public');
    v_count := v_count + 1;
  END LOOP;

  FOR v IN SELECT * FROM public.registry_company_people WHERE record_id = p_record_id AND public_visible = true AND display_name IS NOT NULL LOOP
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'person_display_name', 'Matched on officer/director name (public)',
            v.display_name, public.registry_normalise_search_value(v.display_name), 'public');
    v_count := v_count + 1;
  END LOOP;

  -- admin tier
  FOR v IN SELECT * FROM public.registry_company_people WHERE record_id = p_record_id LOOP
    IF v.full_name IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'person_full_name', 'Matched on officer/director full name (admin)',
              v.full_name, public.registry_normalise_search_value(v.full_name), 'admin');
    END IF;
    IF v.personal_email IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'person_email', 'Matched on personal email (admin)',
              v.personal_email, public.registry_normalise_search_value(v.personal_email), 'admin');
    END IF;
    IF v.personal_phone IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'person_phone', 'Matched on personal phone (admin)',
              v.personal_phone, public.registry_normalise_search_value(v.personal_phone), 'admin');
    END IF;
    IF v.personal_address IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'person_address', 'Matched on personal address (admin)',
              v.personal_address, public.registry_normalise_search_value(v.personal_address), 'admin');
    END IF;
  END LOOP;
  FOR v IN SELECT * FROM public.registry_company_events WHERE record_id = p_record_id LOOP
    IF v.raw_text IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'event_raw_text', 'Matched on raw event text (admin)',
              v.raw_text, public.registry_normalise_search_value(v.raw_text), 'admin');
    END IF;
  END LOOP;
  FOR v IN SELECT * FROM public.registry_company_filings WHERE record_id = p_record_id LOOP
    IF v.raw_text IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'filing_raw_text', 'Matched on raw filing text (admin)',
              v.raw_text, public.registry_normalise_search_value(v.raw_text), 'admin');
    END IF;
    IF v.source_document_reference IS NOT NULL THEN
      INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
      VALUES (p_record_id, 'filing_source_document', 'Matched on source document reference (admin)',
              v.source_document_reference, public.registry_normalise_search_value(v.source_document_reference), 'admin');
    END IF;
  END LOOP;
  IF rec.internal_confidence_notes IS NOT NULL THEN
    INSERT INTO public.registry_company_search_index (record_id, field_kind, field_label, value_raw, value_normalised, tier)
    VALUES (p_record_id, 'internal_notes', 'Matched on internal confidence notes (admin)',
            rec.internal_confidence_notes, public.registry_normalise_search_value(rec.internal_confidence_notes), 'admin');
  END IF;

  INSERT INTO public.registry_company_record_events (record_id, event_name, payload)
  VALUES (p_record_id, 'registry_company_record_indexed', jsonb_build_object('count', v_count));

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.rebuild_registry_company_search_index(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_registry_company_search_index(UUID) TO service_role;

-- Admin-only seed of controlled sample records.
CREATE OR REPLACE FUNCTION public.admin_seed_batch8_sample_records()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids UUID[] := ARRAY[]::UUID[]; v_id UUID;
BEGIN
  IF NOT public.has_role(auth.uid(), 'platform_admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.registry_company_records WHERE provenance_reference = 'batch8_seed_v1';

  INSERT INTO public.registry_company_records
    (country_code, company_name, registration_number, local_number, legal_form, company_status,
     registered_address, source_summary, source_generated_date, provenance_reference)
  VALUES ('NG', 'Adebayo Trading Enterprise', 'BN-1029384', 'LAG-44012', 'Sole Proprietor', 'active',
     '14 Awolowo Road, Ikoyi, Lagos',
     'Imported from public CAC business name register snapshot 2025-09', '2025-09-01', 'batch8_seed_v1')
  RETURNING id INTO v_id;
  v_ids := v_ids || v_id;
  PERFORM public.rebuild_registry_company_search_index(v_id);

  INSERT INTO public.registry_company_records
    (country_code, company_name, registration_number, vat_number, legal_form, company_status,
     registered_address, source_summary, source_generated_date, provenance_reference)
  VALUES ('NG', 'Greenstone Logistics Limited', 'RC-1572044', 'TIN-203-44-5821', 'Private Limited', 'active',
     '7 Adeola Odeku Street, Victoria Island, Lagos',
     'Imported from public CAC company register snapshot 2025-09', '2025-09-01', 'batch8_seed_v1')
  RETURNING id INTO v_id;
  v_ids := v_ids || v_id;
  INSERT INTO public.registry_company_identifiers (record_id, identifier_kind, identifier_value, public_visible)
  VALUES (v_id, 'trading_name', 'Greenstone Logistics', true),
         (v_id, 'previous_name', 'Greenstone Freight Limited', true);
  INSERT INTO public.registry_company_people (record_id, role_kind, display_name, full_name, personal_email, public_visible)
  VALUES (v_id, 'director', 'C. Okafor', 'Chinedu Okafor', 'chinedu@greenstone.example', true);
  INSERT INTO public.registry_company_activities (record_id, activity_summary, public_visible)
  VALUES (v_id, 'Road freight logistics and warehousing', true);
  INSERT INTO public.registry_company_filings (record_id, filing_label, filing_summary, filing_date, public_visible)
  VALUES (v_id, 'annual_return', 'Annual return filed', '2025-04-15', true);
  PERFORM public.rebuild_registry_company_search_index(v_id);

  INSERT INTO public.registry_company_records
    (country_code, company_name, registration_number, vat_number, legal_form, company_status,
     registered_address, source_summary, source_generated_date, provenance_reference)
  VALUES ('ZA', 'Karoo Solar (Pty) Ltd', '2018/445221/07', '4880291442', 'Pty Ltd', 'active',
     '12 Sandown Crescent, Sandton, Johannesburg',
     'Imported from public CIPC disclosure snapshot 2025-10', '2025-10-01', 'batch8_seed_v1')
  RETURNING id INTO v_id;
  v_ids := v_ids || v_id;
  INSERT INTO public.registry_company_identifiers (record_id, identifier_kind, identifier_value, public_visible)
  VALUES (v_id, 'trading_name', 'Karoo Solar', true);
  INSERT INTO public.registry_company_people (record_id, role_kind, display_name, full_name, public_visible)
  VALUES (v_id, 'director', 'S. Mokoena', 'Sipho Mokoena', true);
  PERFORM public.rebuild_registry_company_search_index(v_id);

  INSERT INTO public.registry_company_records
    (country_code, company_name, registration_number, legal_form, company_status,
     registered_address, source_summary, source_generated_date, provenance_reference)
  VALUES ('ZA', 'Highveld Bakery CC', 'CK1995/088321/23', 'CC', 'active',
     '88 President Street, Boksburg, Gauteng',
     'Imported from public CIPC disclosure snapshot 2025-10', '2025-10-01', 'batch8_seed_v1')
  RETURNING id INTO v_id;
  v_ids := v_ids || v_id;
  INSERT INTO public.registry_company_people (record_id, role_kind, display_name, full_name, public_visible)
  VALUES (v_id, 'member', 'T. Naidoo', 'Thandi Naidoo', true);
  PERFORM public.rebuild_registry_company_search_index(v_id);

  INSERT INTO public.event_store (event_name, aggregate_id, aggregate_type, payload)
  VALUES ('registry_company_record_created', 'batch8_seed_v1', 'registry_company_record',
          jsonb_build_object('seed', true, 'record_ids', v_ids));

  RETURN jsonb_build_object('ok', true, 'record_ids', v_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_seed_batch8_sample_records() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_seed_batch8_sample_records() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_registry_company_records()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_touch_registry_company_records
BEFORE UPDATE ON public.registry_company_records
FOR EACH ROW EXECUTE FUNCTION public.touch_registry_company_records();
