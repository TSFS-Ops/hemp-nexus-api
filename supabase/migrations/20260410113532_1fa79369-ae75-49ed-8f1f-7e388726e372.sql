-- FIX 1: Remove the overly permissive counterparties SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view all counterparties" ON public.counterparties;

-- FIX 2: Remove matches and notifications from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.matches;
ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;