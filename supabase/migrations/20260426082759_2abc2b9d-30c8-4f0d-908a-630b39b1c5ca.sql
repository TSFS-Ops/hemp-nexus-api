CREATE OR REPLACE FUNCTION public.get_org_gate_position(_org_id uuid)
RETURNS gate_position
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (
      SELECT verification_gate_position
      FROM public.org_governance_profiles
      WHERE org_id = _org_id
        AND effective_to IS NULL
      ORDER BY effective_from DESC
      LIMIT 1
    ),
    'wad_only'::public.gate_position
  );
$function$;

COMMENT ON FUNCTION public.get_org_gate_position(uuid) IS
  'Resolves the verification gate posture for an org. Default posture is wad_only (verification deferred to WaD certification gates) so unverified orgs are not blocked at POI mint or outreach. Admins can override per-org via org_governance_profiles.';