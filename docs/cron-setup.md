# Cron Job Setup for Automation

This guide explains how to set up automated cron jobs for webhook retries and API key expiry automation.

## Prerequisites

- Supabase project with `pg_cron` and `pg_net` extensions enabled
- Service role key access

## Enable Required Extensions

Run these SQL commands in your Supabase SQL Editor:

```sql
-- Enable pg_cron extension for scheduling
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;
```

## 1. Webhook Retry Automation

Schedule the webhook-retry function to run every 5 minutes:

```sql
SELECT cron.schedule(
  'webhook-retry-job',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT
    net.http_post(
        url := 'https://api.trade.izenzo.co.za/functions/v1/webhook-retry',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{}'::jsonb
    ) as request_id;
  $$
);
```

**Configuration Options:**
- `*/5 * * * *` - Every 5 minutes (recommended)
- `*/10 * * * *` - Every 10 minutes (lighter load)
- `*/15 * * * *` - Every 15 minutes (minimal load)

## 2. API Key Expiry Automation

Schedule the api-key-expiry function to run daily at 9 AM:

```sql
SELECT cron.schedule(
  'api-key-expiry-job',
  '0 9 * * *',  -- Daily at 9:00 AM UTC
  $$
  SELECT
    net.http_post(
        url := 'https://api.trade.izenzo.co.za/functions/v1/api-key-expiry',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{}'::jsonb
    ) as request_id;
  $$
);
```

**Configuration Options:**
- `0 9 * * *` - Daily at 9:00 AM (recommended)
- `0 */6 * * *` - Every 6 hours (more frequent checks)
- `0 0 * * *` - Daily at midnight (off-peak hours)

## 3. Data Retention Enforcement

Schedule the data-retention function to run daily at 2 AM UTC to flag records approaching the 7-year mark:

```sql
SELECT cron.schedule(
  'data-retention-job',
  '0 2 * * *',  -- Daily at 2:00 AM UTC
  $$
  SELECT
    net.http_post(
        url := 'https://api.trade.izenzo.co.za/functions/v1/data-retention',
        headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_ANON_KEY"}'::jsonb,
        body := '{}'::jsonb
    ) as request_id;
  $$
);
```

**Configuration Options:**
- `0 2 * * *` - Daily at 2:00 AM UTC (recommended, off-peak)
- `0 0 * * 0` - Weekly on Sunday at midnight (lighter load)

## 3. Verify Cron Jobs

Check scheduled jobs:

```sql
SELECT * FROM cron.job;
```

## 4. View Cron Job Logs

Check execution history:

```sql
SELECT * FROM cron.job_run_details 
ORDER BY start_time DESC 
LIMIT 10;
```

## 5. Update or Delete Jobs

Update schedule:

```sql
SELECT cron.schedule(
  'webhook-retry-job',
  '*/10 * * * *',  -- New schedule
  $$ ... $$
);
```

Delete a job:

```sql
SELECT cron.unschedule('webhook-retry-job');
SELECT cron.unschedule('api-key-expiry-job');
```

## Important Notes

1. **Replace `YOUR_ANON_KEY`** with your actual Supabase anon key
2. Cron runs in **UTC timezone** - adjust times accordingly
3. Monitor cron logs to ensure jobs are running successfully
4. Consider implementing alerts for failed job executions

## Cron Expression Reference

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday to Saturday)
│ │ │ │ │
│ │ │ │ │
* * * * *
```

Examples:
- `*/5 * * * *` - Every 5 minutes
- `0 * * * *` - Every hour
- `0 9 * * *` - Daily at 9 AM
- `0 0 * * 0` - Weekly on Sunday at midnight
- `0 0 1 * *` - Monthly on the 1st at midnight
