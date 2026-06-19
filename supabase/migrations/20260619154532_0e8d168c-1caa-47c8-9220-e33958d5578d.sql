
-- Public API V1 · Sand/Prod Batch 7 — Webhook environment-awareness + sandbox-test gate
ALTER TABLE public.webhook_endpoints
  ADD COLUMN IF NOT EXISTS environment text,
  ADD COLUMN IF NOT EXISTS api_client_id uuid REFERENCES public.api_clients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sandbox_test_passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sandbox_test_event_id uuid,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
  ADD COLUMN IF NOT EXISTS failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webhook_endpoints_env_check') THEN
    ALTER TABLE public.webhook_endpoints
      ADD CONSTRAINT webhook_endpoints_env_check
      CHECK (environment IS NULL OR environment IN ('sandbox','production'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS webhook_endpoints_api_client_env_idx
  ON public.webhook_endpoints(api_client_id, environment) WHERE api_client_id IS NOT NULL;

-- Trigger: production webhook endpoints may not be enabled (status='active')
-- until a sandbox webhook test has passed for the same api_client_id.
CREATE OR REPLACE FUNCTION public.api_webhook_endpoint_production_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.environment = 'production'
     AND NEW.status = 'active'
     AND NEW.api_client_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.webhook_endpoints sandbox
      WHERE sandbox.api_client_id = NEW.api_client_id
        AND sandbox.environment = 'sandbox'
        AND sandbox.sandbox_test_passed_at IS NOT NULL
    ) THEN
      INSERT INTO public.audit_logs(org_id, action, entity_type, entity_id, metadata)
      VALUES (NEW.org_id,
              'api.webhook.production.blocked_until_sandbox_tested',
              'webhook_endpoint', NEW.id,
              jsonb_build_object('api_client_id', NEW.api_client_id, 'url', NEW.url));
      RAISE EXCEPTION 'api.webhook.production.blocked_until_sandbox_tested: sandbox webhook test must pass for api_client_id % before enabling production endpoint', NEW.api_client_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS api_webhook_endpoint_production_gate_trg ON public.webhook_endpoints;
CREATE TRIGGER api_webhook_endpoint_production_gate_trg
  BEFORE INSERT OR UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION public.api_webhook_endpoint_production_gate();
