-- Batch 1 hardening: API Usage Dashboard V1 data model
-- Adds 3 new nullable scalar columns (correlation_id maps to existing request_id; not duplicated)
-- and a defence-in-depth trigger that hard-nulls any request_body / response_body writes.

ALTER TABLE public.api_request_logs
  ADD COLUMN IF NOT EXISTS non_billable_reason   text,
  ADD COLUMN IF NOT EXISTS quota_position_after  integer,
  ADD COLUMN IF NOT EXISTS token_cost_units      integer;

COMMENT ON COLUMN public.api_request_logs.non_billable_reason  IS 'Optional reason why this call was not billable (e.g. health, error, exempt).';
COMMENT ON COLUMN public.api_request_logs.quota_position_after IS 'Snapshot of remaining quota after this call, for dashboard display.';
COMMENT ON COLUMN public.api_request_logs.token_cost_units     IS 'Token / credit units charged for this call (0 for non-billable).';
COMMENT ON COLUMN public.api_request_logs.request_id           IS 'Correlation id (correlation_id maps to this column; do not duplicate).';

-- Defence-in-depth: never persist request or response payloads.
CREATE OR REPLACE FUNCTION public.api_request_logs_strip_payloads()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.request_body  := NULL;
  NEW.response_body := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_api_request_logs_strip_payloads ON public.api_request_logs;
CREATE TRIGGER trg_api_request_logs_strip_payloads
  BEFORE INSERT OR UPDATE ON public.api_request_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.api_request_logs_strip_payloads();