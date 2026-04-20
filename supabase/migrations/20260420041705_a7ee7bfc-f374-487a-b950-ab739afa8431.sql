-- Enable realtime publication for user_roles so AuthContext can subscribe to live role changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'user_roles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_roles;
  END IF;
END $$;

-- Ensure full row data is sent on UPDATE/DELETE (needed for client to identify which user changed)
ALTER TABLE public.user_roles REPLICA IDENTITY FULL;