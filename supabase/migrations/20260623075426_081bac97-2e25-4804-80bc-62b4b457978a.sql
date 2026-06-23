-- Idempotency guard for admin engagement-reminder notifications.
-- Prevents duplicate UNRESOLVED admin reminders for the same poi_engagement
-- and recipient, while leaving all other notification types/recipients alone.
-- A future legitimate reminder is still allowed once the prior reminder is resolved
-- (resolved_at IS NOT NULL).
CREATE UNIQUE INDEX IF NOT EXISTS notifications_engagement_reminder_unresolved_uniq
  ON public.notifications (entity_id, user_id)
  WHERE type = 'engagement_reminder'
    AND entity_type = 'poi_engagement'
    AND resolved_at IS NULL;