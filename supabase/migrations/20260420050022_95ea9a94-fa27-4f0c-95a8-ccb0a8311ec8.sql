-- ── 1. Remove user_roles from realtime publication ──
-- Broadcasting role changes to all subscribers is a privilege-escalation
-- information leak. We replace this with client-side polling on tab focus.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_roles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.user_roles';
  END IF;
END $$;

-- ── 2. Defense-in-depth: deny-by-default on realtime.messages ──
-- Without an RLS policy on realtime.messages, any authenticated user can
-- subscribe to any channel topic. We enable RLS and add no permissive
-- policies, which blocks all subscriptions by default. Specific channels
-- can be opened later via targeted policies that scope by topic + auth.uid().
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Drop any prior permissive policy we may have added in earlier iterations
DROP POLICY IF EXISTS "deny_all_realtime_messages" ON realtime.messages;

-- Explicit deny policy (RLS already denies by default when no policy matches,
-- but an explicit policy makes the intent visible in audits).
CREATE POLICY "deny_all_realtime_messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (false);
