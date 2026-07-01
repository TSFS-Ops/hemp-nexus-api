-- Batch B3 — WaD attestations sealed-parent immutability.
--
-- After a parent WaD is sealed, its attestations are part of the sealed
-- evidence record and must never be edited or deleted. Normal
-- authenticated users are already blocked by RLS, but service_role and
-- the table owner bypass RLS. A BEFORE UPDATE OR DELETE trigger closes
-- that gap for every caller, without an allowlist (no legitimate
-- post-seal writer exists — signer changes go through a new
-- WaD/supersession flow).
--
-- Scope: trigger + function only. No RLS, no GRANT/REVOKE, no policy,
-- no ownership change, no FORCE RLS, no touch to Batch B1 TRUNCATE
-- trigger or the C10 WaD seal trigger.

CREATE OR REPLACE FUNCTION public.assert_wad_attestation_sealed_parent_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wad_id uuid;
  v_sealed_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_wad_id := OLD.wad_id;
  ELSE
    v_wad_id := OLD.wad_id;
  END IF;

  SELECT w.sealed_at INTO v_sealed_at
    FROM public.wads w
   WHERE w.id = v_wad_id;

  IF v_sealed_at IS NOT NULL THEN
    RAISE EXCEPTION
      'wad_attestation_sealed_parent_immutable: % on public.wad_attestations is not permitted after parent WaD % was sealed at %',
      TG_OP, v_wad_id, v_sealed_at
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wad_attestations_sealed_parent_immutability_trg
  ON public.wad_attestations;

CREATE TRIGGER wad_attestations_sealed_parent_immutability_trg
  BEFORE UPDATE OR DELETE ON public.wad_attestations
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_wad_attestation_sealed_parent_immutability();