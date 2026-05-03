-- D-06: Email dispatcher heartbeat columns
ALTER TABLE public.email_send_state
  ADD COLUMN IF NOT EXISTS last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_error_at timestamptz;

COMMENT ON COLUMN public.email_send_state.last_run_at IS 'D-06: Updated at the start of every process-email-queue tick (cron heartbeat). If now() - last_run_at > 120s the dispatcher is stale.';
COMMENT ON COLUMN public.email_send_state.last_success_at IS 'D-06: Updated when a tick completes without an unhandled error (including no-op idle ticks).';
COMMENT ON COLUMN public.email_send_state.last_error IS 'D-06: Last unhandled error message from the dispatcher (truncated to 1000 chars).';
COMMENT ON COLUMN public.email_send_state.last_error_at IS 'D-06: Timestamp of the last unhandled dispatcher error.';