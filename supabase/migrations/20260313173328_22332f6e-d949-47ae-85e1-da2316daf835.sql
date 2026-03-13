-- F1: Replace overly broad trade_approvals SELECT with org-scoped policy
DROP POLICY IF EXISTS "Authenticated users view trade approval status" ON public.trade_approvals;

CREATE POLICY "Users view own org trade approvals"
ON public.trade_approvals FOR SELECT TO authenticated
USING (
  org_id IN (SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid())
  OR public.is_admin(auth.uid())
);

-- F2: Trigger to auto-insert audit_logs on disputes INSERT
CREATE OR REPLACE FUNCTION public.audit_dispute_creation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    org_id,
    entity_type,
    entity_id,
    action,
    actor_user_id,
    metadata
  ) VALUES (
    NEW.raised_by_org_id,
    'dispute',
    NEW.id,
    'dispute.raised',
    NEW.raised_by_user_id,
    jsonb_build_object(
      'match_id', NEW.match_id,
      'reason', NEW.reason,
      'status', NEW.status
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_audit_dispute_creation
AFTER INSERT ON public.disputes
FOR EACH ROW
EXECUTE FUNCTION public.audit_dispute_creation();