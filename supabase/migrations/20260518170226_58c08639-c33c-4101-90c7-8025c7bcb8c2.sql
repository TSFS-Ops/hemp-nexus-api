-- MT-009 Phase 2 — fix read visibility for Named Contact panel.
--
-- Root cause: match_named_contacts RLS only allows a user to SELECT rows
-- where org_id matches their own profile.org_id. A buyer-side user therefore
-- cannot see the seller-side controlled contact row, and the panel falsely
-- reports the seller side as missing.
--
-- Fix: SECURITY DEFINER RPC that returns active controlled-contact rows for
-- a match (both sides) to authorised match participants only:
--   - platform_admin; OR
--   - caller profile.org_id matches buyer_org_id; OR
--   - caller profile.org_id matches seller_org_id.
--
-- The RPC returns only safe display fields. RLS on the base table is NOT
-- weakened — direct SELECTs from non-org members still return zero rows.
-- Read-only. No mutation. No notification, POI, WaD, payment, or credit
-- side effects.

CREATE OR REPLACE FUNCTION public.get_match_named_contact_status(p_match_id uuid)
RETURNS TABLE (
  id uuid,
  match_id uuid,
  side text,
  org_id uuid,
  contact_name text,
  contact_email text,
  assigned_by_role text,
  assigned_at timestamptz,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_buyer uuid;
  v_seller uuid;
  v_caller_org uuid;
  v_is_admin boolean;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT m.buyer_org_id, m.seller_org_id
    INTO v_buyer, v_seller
    FROM public.matches m
    WHERE m.id = p_match_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MATCH_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_is_admin := public.is_admin(v_caller);

  SELECT p.org_id INTO v_caller_org
    FROM public.profiles p
    WHERE p.id = v_caller;

  IF NOT v_is_admin
     AND (v_caller_org IS NULL
          OR (v_caller_org IS DISTINCT FROM v_buyer
              AND v_caller_org IS DISTINCT FROM v_seller)) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT
      c.id,
      c.match_id,
      c.side::text,
      c.org_id,
      c.contact_name,
      c.contact_email,
      c.assigned_by_role::text,
      c.assigned_at,
      c.status::text
    FROM public.match_named_contacts c
    WHERE c.match_id = p_match_id
      AND c.status = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.get_match_named_contact_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_match_named_contact_status(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_match_named_contact_status(uuid) IS
'MT-009 Phase 2: returns active controlled named-contact rows for both sides of a match to authorised match participants (buyer org member, seller org member, or platform admin). SECURITY DEFINER; bypasses base-table RLS only to widen visibility within a single match. Read-only.';