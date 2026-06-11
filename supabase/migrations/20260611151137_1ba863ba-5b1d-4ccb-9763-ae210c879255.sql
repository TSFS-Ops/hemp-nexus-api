
CREATE OR REPLACE FUNCTION public.data_004_cron_drift_check()
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE SECURITY DEFINER
  SET search_path TO 'public', 'cron'
AS $function$
declare
  v_expected_active  text[] := array[
    'account-deletion-sweeper-daily-dryrun',
    'purge-email-send-log-daily-dryrun',
    'purge-email-send-log-daily-live',
    'cold-storage-archive-dryrun',
    'cold-storage-archive-live'
  ];
  v_expected_inactive text[] := array['storage-retention-cleanup-job'];
  v_forbidden text[] := array[
    'purge-email-send-log-daily',
    'email-log-anonymise-daily',
    'account-deletion-sweeper-daily',
    'cold-storage-archive-weekly'
  ];
  v_expected_schedule jsonb := jsonb_build_object(
    'account-deletion-sweeper-daily-dryrun','15 3 * * *',
    'purge-email-send-log-daily-dryrun','20 3 * * *',
    'purge-email-send-log-daily-live','50 3 * * *',
    'cold-storage-archive-dryrun','40 3 * * 0',
    'cold-storage-archive-live','10 4 * * 0',
    'storage-retention-cleanup-job','0 2 * * *'
  );
  v_expected_dry_run jsonb := jsonb_build_object(
    'account-deletion-sweeper-daily-dryrun',true,
    'purge-email-send-log-daily-dryrun',true,
    'purge-email-send-log-daily-live',false,
    'cold-storage-archive-dryrun',true,
    'cold-storage-archive-live',false
  );
  v_data_004_keywords text[] := array['purge-email-send-log','email-log-anonymise','account-deletion-sweeper','cold-storage-archive'];
  v_actual jsonb := '[]'::jsonb;
  v_findings jsonb := '[]'::jsonb;
  v_jobname text; v_expected_sched text; v_expected_dr boolean; v_row record;
  v_has_dr_true boolean; v_has_dr_false boolean; v_has_internal_key boolean;
  v_body_stripped text;
  v_crit int := 0; v_high int := 0; v_med int := 0; v_low int := 0;
  v_status text;
begin
  -- Snapshot cron.job into v_actual
  for v_row in
    select j.jobid, j.jobname, j.schedule, j.active,
           regexp_replace(coalesce(j.command,''), '\s+', '', 'g') as body_stripped
    from cron.job j
  loop
    v_actual := v_actual || jsonb_build_object(
      'jobid', v_row.jobid,
      'jobname', v_row.jobname,
      'schedule', v_row.schedule,
      'active', v_row.active
    );
  end loop;

  -- 1) forbidden present
  for v_row in select j.jobname from cron.job j where j.jobname = any(v_forbidden) loop
    v_crit := v_crit + 1;
    v_findings := v_findings || jsonb_build_object(
      'severity','critical','code','FORBIDDEN_JOB_PRESENT',
      'jobname', v_row.jobname,
      'detail','quarantined jobname reappeared in cron.job',
      'recommended_action', format($u$SELECT cron.unschedule(%L);$u$, v_row.jobname)
    );
  end loop;

  -- 2) inactive expected to be inactive — flag if active
  for v_row in select j.jobname, j.active from cron.job j where j.jobname = any(v_expected_inactive) loop
    if v_row.active then
      v_crit := v_crit + 1;
      v_findings := v_findings || jsonb_build_object(
        'severity','critical','code','INACTIVE_JOB_BECAME_ACTIVE',
        'jobname', v_row.jobname, 'detail','approved-inactive job is currently active',
        'recommended_action', format($u$UPDATE cron.job SET active = false WHERE jobname = %L;$u$, v_row.jobname)
      );
    end if;
  end loop;

  -- 3) expected_active checks
  foreach v_jobname in array v_expected_active loop
    select j.jobid, j.jobname, j.schedule, j.active,
           regexp_replace(coalesce(j.command,''), '\s+', '', 'g') as body_stripped
      into v_row
      from cron.job j where j.jobname = v_jobname;
    if v_row.jobid is null then
      v_high := v_high + 1;
      v_findings := v_findings || jsonb_build_object(
        'severity','high','code','EXPECTED_JOB_MISSING',
        'jobname', v_jobname, 'detail','approved job is absent from cron.job',
        'recommended_action','re-schedule via the approved batch that owns this job');
      continue;
    end if;
    if not v_row.active then
      v_high := v_high + 1;
      v_findings := v_findings || jsonb_build_object(
        'severity','high','code','EXPECTED_JOB_INACTIVE',
        'jobname', v_jobname, 'detail','approved job exists but is not active',
        'recommended_action', format($u$UPDATE cron.job SET active = true WHERE jobname = %L;$u$, v_jobname));
    end if;
    v_expected_sched := v_expected_schedule->>v_jobname;
    if v_expected_sched is not null and v_row.schedule is distinct from v_expected_sched then
      v_high := v_high + 1;
      v_findings := v_findings || jsonb_build_object(
        'severity','high','code','SCHEDULE_DRIFT',
        'jobname', v_jobname,
        'detail', format('expected %s, actual %s', v_expected_sched, v_row.schedule),
        'recommended_action','re-schedule via approved batch');
    end if;

    v_body_stripped := v_row.body_stripped;
    v_has_dr_true := position('"dry_run":true' in v_body_stripped) > 0;
    v_has_dr_false := position('"dry_run":false' in v_body_stripped) > 0;
    v_has_internal_key := position('x-internal-key' in v_body_stripped) > 0
                          or position('INTERNAL_CRON_KEY' in v_body_stripped) > 0;
    if (v_expected_dry_run ? v_jobname) then
      v_expected_dr := (v_expected_dry_run->>v_jobname)::boolean;
      if v_expected_dr is true and not v_has_dr_true then
        v_crit := v_crit + 1;
        v_findings := v_findings || jsonb_build_object(
          'severity','critical','code','DRY_RUN_BODY_DRIFT',
          'jobname', v_jobname,
          'detail','approved dry-run job body no longer pins "dry_run":true',
          'recommended_action','restore approved dry-run cron body');
      end if;
      if v_expected_dr is false and not v_has_dr_false then
        v_crit := v_crit + 1;
        v_findings := v_findings || jsonb_build_object(
          'severity','critical','code','LIVE_BODY_DRIFT',
          'jobname', v_jobname,
          'detail','approved live job body no longer pins "dry_run":false',
          'recommended_action','restore approved live cron body');
      end if;
      if v_expected_dr is false and v_has_dr_true then
        v_crit := v_crit + 1;
        v_findings := v_findings || jsonb_build_object(
          'severity','critical','code','LIVE_BODY_DRIFT',
          'jobname', v_jobname,
          'detail','approved live job body pins "dry_run":true (must be false)',
          'recommended_action','restore approved live cron body');
      end if;
    end if;
    if not v_has_internal_key then
      v_crit := v_crit + 1;
      v_findings := v_findings || jsonb_build_object(
        'severity','critical','code','AUTH_PATTERN_DRIFT',
        'jobname', v_jobname,
        'detail','DATA-004 cron body no longer carries x-internal-key auth header',
        'recommended_action','restore approved cron body with x-internal-key from vault');
    end if;
  end loop;

  -- 4) unexpected DATA-004 jobs
  for v_row in
    select j.jobname from cron.job j
    where j.jobname is not null
      and not (j.jobname = any(v_expected_active))
      and not (j.jobname = any(v_expected_inactive))
      and not (j.jobname = any(v_forbidden))
      and exists (
        select 1 from unnest(v_data_004_keywords) k where position(k in coalesce(j.jobname,'')) > 0
      )
  loop
    v_high := v_high + 1;
    v_findings := v_findings || jsonb_build_object(
      'severity','high','code','UNEXPECTED_DATA_004_JOB',
      'jobname', v_row.jobname,
      'detail','job references DATA-004 keywords but is not in the approved contract',
      'recommended_action','review and either approve via a new batch or unschedule');
  end loop;

  if v_crit > 0 or v_high > 0 then v_status := 'fail';
  elsif v_med > 0 then v_status := 'warn';
  else v_status := 'pass';
  end if;

  return jsonb_build_object(
    'status', v_status,
    'read_only', true,
    'last_checked', now(),
    'contract_version', 'data-004-batch-19',
    'expected_active', to_jsonb(v_expected_active),
    'expected_inactive', to_jsonb(v_expected_inactive),
    'forbidden_absent', to_jsonb(v_forbidden),
    'expected_schedule', v_expected_schedule,
    'expected_dry_run', v_expected_dry_run,
    'actual', v_actual,
    'findings', v_findings,
    'summary', jsonb_build_object(
      'critical', v_crit, 'high', v_high, 'medium', v_med, 'low', v_low,
      'total', v_crit + v_high + v_med + v_low
    )
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.data_004_cron_drift_check() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.data_004_cron_drift_check() TO service_role;
