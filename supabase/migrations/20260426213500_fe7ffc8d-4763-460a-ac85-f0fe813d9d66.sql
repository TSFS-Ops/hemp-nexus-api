-- audit_logs: allow platform_admin and auditor to read all rows
CREATE POLICY "Platform admins can view all audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::public.app_role));

CREATE POLICY "Auditors can view all audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'auditor'::public.app_role));

-- token_ledger: allow platform_admin and auditor to read all rows
CREATE POLICY "Platform admins can view all token ledger entries"
ON public.token_ledger
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'platform_admin'::public.app_role));

CREATE POLICY "Auditors can view all token ledger entries"
ON public.token_ledger
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'auditor'::public.app_role));