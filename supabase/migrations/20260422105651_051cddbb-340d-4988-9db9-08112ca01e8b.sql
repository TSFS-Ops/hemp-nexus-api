-- Enable Realtime for poi_engagements so reviewer support-notes edits and
-- status changes propagate live across admin browser sessions.
ALTER TABLE public.poi_engagements REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.poi_engagements;