
-- Allow authenticated users to insert behavioral signals for their own org
CREATE POLICY "Authenticated users can insert own signals"
ON public.behavioral_signals
FOR INSERT
TO authenticated
WITH CHECK (
  org_id IS NULL OR org_id = (
    SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
  )
);
