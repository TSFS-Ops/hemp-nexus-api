-- Fix security issue: Add RLS to match_evidence view
-- Note: match_evidence is a VIEW, so we enable RLS on underlying tables

-- Update reputation_scores to restrict access to own org only
DROP POLICY IF EXISTS "Anyone authenticated can view reputation scores" ON public.reputation_scores;

CREATE POLICY "Users can view their own org reputation"
ON public.reputation_scores
FOR SELECT
USING (org_id IN (
  SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()
));

-- Add policy for admins to view all
CREATE POLICY "Admins can view all reputation scores"
ON public.reputation_scores
FOR SELECT
USING (has_role(auth.uid(), 'admin'));

-- Restrict api_request_logs to admins and auditors only (remove regular user access)
DROP POLICY IF EXISTS "Users can view their org's API request logs" ON public.api_request_logs;

CREATE POLICY "Admins and auditors can view API request logs"
ON public.api_request_logs
FOR SELECT
USING (
  has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'auditor')
);

-- Restrict audit_logs to admins only (remove general user access for security)
DROP POLICY IF EXISTS "Users can view their org's audit logs" ON public.audit_logs;

-- Keep admin access only
-- Already has "Admins can view all audit logs" policy

-- Add comment documenting security decisions
COMMENT ON TABLE public.behavioral_signals IS 'Non-binding user interactions (skip, maybe_later, view). These do NOT create legal intent or audit records. Only Confirm Intent creates binding records.';