CREATE OR REPLACE FUNCTION public.get_match_evidence(p_match_id uuid, p_org_id uuid)
RETURNS TABLE(match_id uuid, org_id uuid, match_created_at timestamptz, settled_at timestamptz, match_data jsonb, event_timeline jsonb, match_hash text, status text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT match_id, org_id, match_created_at, settled_at, match_data, event_timeline, match_hash, status
  FROM match_evidence
  WHERE match_evidence.match_id = p_match_id
    AND match_evidence.org_id = p_org_id
    AND (
      -- 3) Supabase service_role backend calls (no auth.uid())
      current_setting('request.jwt.claim.role', true) = 'service_role'
      OR (
        auth.uid() IS NOT NULL
        AND (
          -- 1) Authenticated caller belongs to the requested org
          EXISTS (
            SELECT 1 FROM public.profiles pr
            WHERE pr.id = auth.uid()
              AND pr.org_id = p_org_id
          )
          -- 2) Platform admin
          OR public.has_role(auth.uid(), 'platform_admin'::app_role)
        )
      )
    );
$function$;