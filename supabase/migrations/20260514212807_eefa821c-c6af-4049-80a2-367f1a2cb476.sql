-- POI-004 Stage 2: downstream notification/email/webhook dedupe hardening
-- Defence-in-depth so a future refactor cannot fan out duplicate POI
-- notifications, emails, revenue notices, or webhook deliveries even if the
-- upstream POI mint guard is bypassed.

-- ──────────────────────────────────────────────────────────────────────────
-- Pre-flight: abort if any current data would violate the new constraints.
-- The reconcile path is "investigate the dup, then re-run", not "drop the
-- guard". This mirrors the abort guard from the POI-004 stage-1 migration.
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  notif_dups       integer;
  rev_audit_dups   integer;
BEGIN
  SELECT COALESCE(SUM(c), 0) INTO notif_dups FROM (
    SELECT 1 AS c
    FROM public.notifications
    WHERE type IN ('poi_admin_facilitation','poi_support_desk','poi_counterparty_notification')
    GROUP BY user_id, type, link
    HAVING COUNT(*) > 1
  ) d;

  SELECT COALESCE(SUM(c), 0) INTO rev_audit_dups FROM (
    SELECT 1 AS c
    FROM public.revenue_notification_audit
    WHERE idempotency_key IS NOT NULL
    GROUP BY idempotency_key
    HAVING COUNT(*) > 1
  ) d;

  IF notif_dups > 0 OR rev_audit_dups > 0 THEN
    RAISE EXCEPTION 'POI-004 stage-2 migration aborted: duplicates exist (notifications=%, revenue_notification_audit=%). Resolve via reconciliation before re-applying.',
      notif_dups, rev_audit_dups;
  END IF;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. notifications: structural dedupe for POI notification fanout.
--    Same user + same POI link + same POI type → one row only.
-- ──────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_poi_per_user_link
  ON public.notifications (user_id, type, link)
  WHERE type IN (
    'poi_admin_facilitation',
    'poi_support_desk',
    'poi_counterparty_notification'
  );

-- ──────────────────────────────────────────────────────────────────────────
-- 2. revenue_notification_audit: promote idempotency-key index to UNIQUE.
--    Pre-flight already proved no current duplicates exist.
-- ──────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS public.idx_rev_notif_audit_idem;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rev_notif_audit_idempotency_key
  ON public.revenue_notification_audit (idempotency_key);

-- ──────────────────────────────────────────────────────────────────────────
-- 3. email_send_log: first-class email idempotency.
--    `message_id` is regenerated per invocation, so it cannot dedupe across
--    retries. `idempotency_key` is supplied by callers and is stable.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_email_send_log_idempotency_key
  ON public.email_send_log (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_send_log_idempotency_lookup
  ON public.email_send_log (idempotency_key, created_at DESC)
  WHERE idempotency_key IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. webhook_deliveries: dedupe by stable per-event idempotency key.
--    Populated by callers (e.g. `poi.generated:${matchId}`). Legacy events
--    without a key remain unconstrained.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS event_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_webhook_deliveries_event_idempotency
  ON public.webhook_deliveries (webhook_endpoint_id, event_idempotency_key)
  WHERE event_idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.email_send_log.idempotency_key IS
  'POI-004 stage-2: caller-supplied stable key used by send-transactional-email to short-circuit duplicate sends and return the prior messageId.';

COMMENT ON COLUMN public.webhook_deliveries.event_idempotency_key IS
  'POI-004 stage-2: caller-supplied stable key (e.g. "poi.generated:<matchId>") that prevents duplicate deliveries to the same endpoint for the same logical event.';