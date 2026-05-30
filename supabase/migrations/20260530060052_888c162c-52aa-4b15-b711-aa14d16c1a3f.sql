create or replace function public.data_004_cron_drift_check()
returns jsonb language plpgsql stable security definer set search_path = public, cron as $$
declare
  v_expected_active  text[] := array['account-deletion-sweeper-daily-dryrun','purge-email-send-log-daily-dryrun','cold-storage-archive-dryrun','cold-storage-archive-live'];
  v_expected_inactive text[] := array['storage-retention-cleanup-job'];
  v_forbidden text[] := array['purge-email-send-log-daily','email-log-anonymise-daily','account-deletion-sweeper-daily','cold-storage-archive-weekly'];
  v_expected_schedule jsonb := jsonb_build_object('account-deletion-sweeper-daily-dryrun','15 3 * * *','purge-email-send-log-daily-dryrun','20 3 * * *','cold-storage-archive-dryrun','40 3 * * 0','cold-storage-archive-live','10 4 * * 0','storage-retention-cleanup-job','0 2 * * *');
  v_expected_dry_run jsonb := jsonb_build_object('account-deletion-sweeper-daily-dryrun',true,'purge-email-send-log-daily-dryrun',true,'cold-storage-archive-dryrun',true,'cold-storage-archive-live',false);
  v_data_004_keywords text[] := array['purge-email-send-log','email-log-anonymise','account-deletion-sweeper','cold-storage-archive'];
  v_actual jsonb := '[]'::jsonb;
  v_findings jsonb := '[]'::jsonb;
  v_jobname text; v_expected_sched text; v_expected_dr boolean; v_row record;
  v_has_dr_true boolean; v_has_dr_false boolean; v_has_internal_key boolean;
  v_critical int := 0; v_high int := 0; v_medium int := 0; v_low int := 0; v_status text;
begin
  for v_row in
    select j.jobid, j.jobname, j.schedule, j.active, j.command from cron.job j
    where j.jobname = any(v_expected_active) or j.jobname = any(v_expected_inactive) or j.jobname = any(v_forbidden)
       or exists (select 1 from unnest(v_data_004_keywords) k where j.command ilike '%' || k || '%')
    order by j.jobid
  loop
    v_has_dr_true     := position('"dry_run":true'  in regexp_replace(coalesce(v_row.command,''), '\s+', '', 'g')) > 0;
    v_has_dr_false    := position('"dry_run":false' in regexp_replace(coalesce(v_row.command,''), '\s+', '', 'g')) > 0;
    v_has_internal_key := v_row.command ilike '%x-internal-key%';
    v_actual := v_actual || jsonb_build_object('jobid',v_row.jobid,'jobname',v_row.jobname,'schedule',v_row.schedule,'active',v_row.active,'has_dry_run_true',v_has_dr_true,'has_dry_run_false',v_has_dr_false,'has_internal_key_auth',v_has_internal_key,'command_excerpt',substring(coalesce(v_row.command,'') for 400));
  end loop;
  for v_jobname in select unnest(v_forbidden) loop
    if exists (select 1 from cron.job where jobname = v_jobname) then
      v_findings := v_findings || jsonb_build_object('severity','critical','code','FORBIDDEN_JOB_PRESENT','jobname',v_jobname,'detail','Quarantined/forbidden jobname has reappeared in cron.job.','recommended_action', format('SELECT cron.unschedule(%L);', v_jobname));
      v_critical := v_critical + 1;
    end if;
  end loop;
  for v_jobname in select unnest(v_expected_active) loop
    if not exists (select 1 from cron.job where jobname = v_jobname) then
      v_findings := v_findings || jsonb_build_object('severity','high','code','EXPECTED_JOB_MISSING','jobname',v_jobname,'detail','Approved DATA-004 cron job is missing from cron.job.','recommended_action','Re-install via the original DATA-004 batch migration.');
      v_high := v_high + 1;
    elsif not exists (select 1 from cron.job where jobname = v_jobname and active) then
      v_findings := v_findings || jsonb_build_object('severity','high','code','EXPECTED_JOB_INACTIVE','jobname',v_jobname,'detail','Approved DATA-004 cron job exists but is inactive.','recommended_action','Operator review; do not re-activate without approval.');
      v_high := v_high + 1;
    end if;
  end loop;
  for v_jobname in select unnest(v_expected_inactive) loop
    if exists (select 1 from cron.job where jobname = v_jobname and active) then
      v_findings := v_findings || jsonb_build_object('severity','critical','code','INACTIVE_JOB_BECAME_ACTIVE','jobname',v_jobname,'detail','Job that must remain inactive has been activated without DATA-004 approval.','recommended_action', format('SELECT cron.unschedule(%L);', v_jobname));
      v_critical := v_critical + 1;
    end if;
  end loop;
  for v_row in
    select j.jobid, j.jobname, j.schedule, j.active, j.command from cron.job j
    where j.jobname = any(v_expected_active) or j.jobname = any(v_expected_inactive)
  loop
    v_expected_sched := v_expected_schedule ->> v_row.jobname;
    if v_expected_sched is not null and v_row.schedule is distinct from v_expected_sched then
      v_findings := v_findings || jsonb_build_object('severity','high','code','SCHEDULE_DRIFT','jobname',v_row.jobname,'detail', format('Schedule is %L; expected %L.', v_row.schedule, v_expected_sched),'recommended_action','Operator review; do not edit cron.job directly.');
      v_high := v_high + 1;
    end if;
    if v_expected_dry_run ? v_row.jobname then
      v_expected_dr := (v_expected_dry_run ->> v_row.jobname)::boolean;
      v_has_dr_true  := position('"dry_run":true'  in regexp_replace(coalesce(v_row.command,''), '\s+', '', 'g')) > 0;
      v_has_dr_false := position('"dry_run":false' in regexp_replace(coalesce(v_row.command,''), '\s+', '', 'g')) > 0;
      if v_expected_dr and (not v_has_dr_true or v_has_dr_false) then
        v_findings := v_findings || jsonb_build_object('severity','critical','code','DRY_RUN_BODY_DRIFT','jobname',v_row.jobname,'detail','Approved dry-run job body no longer pins "dry_run": true (or pins false).','recommended_action','Unschedule immediately and re-install from the original DATA-004 migration.');
        v_critical := v_critical + 1;
      elsif (not v_expected_dr) and (v_has_dr_true or not v_has_dr_false) then
        v_findings := v_findings || jsonb_build_object('severity','critical','code','LIVE_BODY_DRIFT','jobname',v_row.jobname,'detail','Approved live job body no longer pins "dry_run": false (or pins true).','recommended_action','Unschedule immediately and re-install from the original DATA-004 migration.');
        v_critical := v_critical + 1;
      end if;
      v_has_internal_key := v_row.command ilike '%x-internal-key%';
      if not v_has_internal_key then
        v_findings := v_findings || jsonb_build_object('severity','critical','code','AUTH_PATTERN_DRIFT','jobname',v_row.jobname,'detail','DATA-004 cron body no longer uses the x-internal-key auth header.','recommended_action','Unschedule immediately and re-install from the original DATA-004 migration.');
        v_critical := v_critical + 1;
      end if;
    end if;
  end loop;
  for v_row in
    select j.jobid, j.jobname, j.active from cron.job j
    where exists (select 1 from unnest(v_data_004_keywords) k where j.command ilike '%' || k || '%' or j.jobname ilike '%' || k || '%')
      and j.jobname <> all(v_expected_active) and j.jobname <> all(v_expected_inactive) and j.jobname <> all(v_forbidden)
  loop
    v_findings := v_findings || jsonb_build_object('severity','high','code','UNEXPECTED_DATA_004_JOB','jobname',v_row.jobname,'detail', format('Unexpected job (jobid=%s, active=%s) references DATA-004 keywords but is not in the approved contract.', v_row.jobid, v_row.active),'recommended_action','Operator review; treat as drift until explicitly approved.');
    v_high := v_high + 1;
  end loop;
  if v_critical > 0 or v_high > 0 then v_status := 'fail';
  elsif v_medium > 0 then v_status := 'warn';
  else v_status := 'pass'; end if;
  return jsonb_build_object('status', v_status, 'read_only', true, 'last_checked', now(),'contract_version','DATA-004 Batch 12','expected_active', to_jsonb(v_expected_active),'expected_inactive', to_jsonb(v_expected_inactive),'forbidden_absent', to_jsonb(v_forbidden),'expected_schedule', v_expected_schedule,'expected_dry_run', v_expected_dry_run,'actual', v_actual, 'findings', v_findings,'summary', jsonb_build_object('critical',v_critical,'high',v_high,'medium',v_medium,'low',v_low,'total',v_critical+v_high+v_medium+v_low));
end; $$;

revoke all on function public.data_004_cron_drift_check() from public;
revoke all on function public.data_004_cron_drift_check() from anon;
revoke all on function public.data_004_cron_drift_check() from authenticated;
grant execute on function public.data_004_cron_drift_check() to service_role;

comment on function public.data_004_cron_drift_check() is 'DATA-004 Batch 12: READ-ONLY live cron drift monitor. Compares cron.job against the approved DATA-004 contract. Performs NO writes. Service-role EXECUTE only; consumed by admin-org-retention (platform_admin only).';