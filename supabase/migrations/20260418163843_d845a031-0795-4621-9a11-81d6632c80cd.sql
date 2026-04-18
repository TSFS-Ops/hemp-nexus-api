DROP POLICY IF EXISTS "Users view own org governance_doc_registry" ON public.governance_doc_registry;

CREATE POLICY "Users view own org governance_doc_registry"
ON public.governance_doc_registry
FOR SELECT
TO authenticated
USING (
  org_id IN (
    SELECT org_id FROM public.profiles WHERE id = auth.uid()
  )
);