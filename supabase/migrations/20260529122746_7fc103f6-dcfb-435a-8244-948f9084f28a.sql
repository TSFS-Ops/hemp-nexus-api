DO $$
DECLARE
  v_org_id uuid := '98989bf1-ce04-4c46-9254-0444781a5127';
  v_cfg_id uuid;
  v_blocked_no_prereqs boolean := false;
  v_blocked_status_only boolean := false;
  v_accepted_with_prereqs boolean := false;
BEGIN
  INSERT INTO public.org_sso_configs (
    org_id, provider, metadata_url, verified_domains,
    status, certificate_status
  ) VALUES (
    v_org_id, 'saml',
    'https://idp.fixture-a.example.com/metadata.xml',
    ARRAY['org-a.example.com']::text[],
    'configured_not_connected', 'none'
  )
  ON CONFLICT (org_id) DO UPDATE SET
    metadata_url      = EXCLUDED.metadata_url,
    verified_domains  = EXCLUDED.verified_domains,
    status            = 'configured_not_connected',
    last_test_result  = NULL,
    last_tested_at    = NULL,
    supabase_sso_provider_id = NULL,
    failure_reason    = NULL
  RETURNING id INTO v_cfg_id;
  RAISE NOTICE 'cfg_id=%, status=configured_not_connected applied', v_cfg_id;

  BEGIN
    UPDATE public.org_sso_configs SET status = 'live' WHERE org_id = v_org_id;
    RAISE NOTICE 'TRIGGER FAILED — status=live accepted without prereqs';
  EXCEPTION WHEN check_violation THEN
    v_blocked_no_prereqs := true;
    RAISE NOTICE 'Trigger BLOCKED status=live (no prereqs) — OK';
  END;

  BEGIN
    UPDATE public.org_sso_configs
       SET status = 'live',
           supabase_sso_provider_id = 'fixture-provider-id',
           last_tested_at = now()
     WHERE org_id = v_org_id;
    RAISE NOTICE 'TRIGGER FAILED — status=live accepted without passing test';
  EXCEPTION WHEN check_violation THEN
    v_blocked_status_only := true;
    RAISE NOTICE 'Trigger BLOCKED status=live (no passing test) — OK';
  END;

  -- Positive control: with all three prereqs, trigger MUST allow status=live.
  BEGIN
    UPDATE public.org_sso_configs
       SET status = 'live',
           supabase_sso_provider_id = 'fixture-provider-id',
           last_tested_at = now(),
           last_test_result = 'pass'
     WHERE org_id = v_org_id;
    v_accepted_with_prereqs := true;
    RAISE NOTICE 'Trigger ACCEPTED status=live with full prereqs — OK';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TRIGGER REGRESSION — status=live blocked even with prereqs';
  END;

  -- Reset back to the realistic Batch 4 demo state (no live SSO).
  UPDATE public.org_sso_configs
     SET status                    = 'configured_not_connected',
         supabase_sso_provider_id  = NULL,
         last_tested_at            = NULL,
         last_test_result          = NULL,
         failure_reason            = NULL
   WHERE org_id = v_org_id;

  INSERT INTO public.audit_logs (action, entity_type, org_id, entity_id, metadata) VALUES
    ('identity.sso_metadata_updated', 'org_sso_identity', v_org_id, v_cfg_id,
     jsonb_build_object('request_id', gen_random_uuid()::text, 'source', 'batch4_internal_test',
       'metadata_url_present', true, 'metadata_xml_present', false,
       'supabase_sso_provider_id', null)),
    ('identity.sso_domains_updated', 'org_sso_identity', v_org_id, v_cfg_id,
     jsonb_build_object('request_id', gen_random_uuid()::text, 'source', 'batch4_internal_test',
       'previous_count', 0, 'new_count', 1)),
    ('identity.sso_connection_tested', 'org_sso_identity', v_org_id, v_cfg_id,
     jsonb_build_object('request_id', gen_random_uuid()::text, 'source', 'batch4_internal_test',
       'result', 'fail', 'reason', 'provider_not_found')),
    ('identity.sso_failed', 'org_sso_identity', v_org_id, v_cfg_id,
     jsonb_build_object('request_id', gen_random_uuid()::text, 'source', 'batch4_internal_test',
       'reason', 'provider_not_found'));

  ASSERT v_blocked_no_prereqs,    'Trigger did NOT block status=live with no prereqs';
  ASSERT v_blocked_status_only,   'Trigger did NOT block status=live without passing test';
  ASSERT v_accepted_with_prereqs, 'Trigger wrongly blocked status=live with full prereqs';
END $$;