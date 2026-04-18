ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Deny all to anon" ON public.email_send_log;

CREATE POLICY "Deny all to anon"
ON public.email_send_log
FOR ALL
TO anon
USING (false);