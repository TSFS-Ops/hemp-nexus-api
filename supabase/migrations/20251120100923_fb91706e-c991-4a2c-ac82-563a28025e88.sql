-- Enable realtime for matches table
ALTER TABLE public.matches REPLICA IDENTITY FULL;

-- Add matches table to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.matches;