-- Stage A: Revoke EXECUTE from PUBLIC/anon/authenticated for trigger-only SECURITY DEFINER functions.
-- These functions are only ever invoked by pg_trigger; triggers run with the table owner's
-- privileges and do not require callers to hold EXECUTE on the trigger function.
-- service_role and postgres retain access (they own them). No business RPCs are touched.

DO $$
DECLARE
  fn text;
  fns text[] := ARRAY[
    'audit_dispute_creation()',
    'audit_dispute_status_change()',
    'audit_persona_change()',
    'auto_link_counterparty_on_registration()',
    'auto_link_engagement_on_signup()',
    'backfill_engagements_on_profile_org()',
    'detect_match_role_inversion()',
    'enforce_poi_engagement_min_ttl()',
    'enforce_poi_engagement_min_ttl_update()',
    'enqueue_storage_deletion()',
    'handle_new_user()',
    'initialize_org_token_balance()',
    'log_maintenance_mode_change()',
    'prevent_frozen_role_assignment()',
    'profiles_sole_member_promote_trg()',
    'record_dispute_to_match_events()',
    'sync_match_counterparty_org()',
    'tg_clip_on_bill_on_pickup()',
    'tg_clip_on_block_unbilled_revert()'
  ];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', fn);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM authenticated', fn);
  END LOOP;
END $$;