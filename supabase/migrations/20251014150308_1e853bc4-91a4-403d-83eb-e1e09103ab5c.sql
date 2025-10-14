-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule SAHPRA cache refresh daily at 2 AM UTC
SELECT cron.schedule(
  'sahpra-daily-refresh',
  '0 2 * * *', -- Every day at 2 AM UTC
  $$
  SELECT
    net.http_get(
      url := 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/sahpra-refresh',
      headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key', true) || '"}'::jsonb
    ) as request_id;
  $$
);