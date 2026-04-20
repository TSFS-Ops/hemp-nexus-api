UPDATE public.notifications
SET link = REPLACE(link, '/dashboard/matches/', '/desk/match/')
WHERE link LIKE '/dashboard/matches/%';