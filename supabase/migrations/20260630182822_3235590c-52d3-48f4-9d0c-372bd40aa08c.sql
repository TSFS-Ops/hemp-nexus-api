-- C10 — Sealed WaD metadata immutability.
--
-- Enforces at the database layer that once a wad has sealed_at set,
-- only a narrow allowlist of revocation / supersession / certificate
-- columns may change, and DELETE is blocked. Fires for all callers,
-- including service_role.

CREATE OR REPLACE FUNCTION public.assert_wad_seal_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Columns that may still change AFTER seal. Each entry corresponds to
  -- an existing or schema-declared post-seal path (revocation,
  -- supersession, certificate persistence, updated_at touch). Do not
  -- broaden silently — see evidence/c10-sealed-records/wad-seal-immutability/README.md.
  allowlist constant text[] := ARRAY[
    'status',
    'revoked_at',
    'revoked_by',
    'revoked_reason',
    'superseded_by_wad_id',
    'certificate_path',
    'certificate_generated_at',
    'updated_at'
  ];
  old_j  jsonb;
  new_j  jsonb;
  k      text;
BEGIN
  -- Pre-seal rows are not enforced.
  IF OLD.sealed_at IS NULL THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  -- Sealed row: block DELETE outright.
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sealed_wad_immutable: cannot DELETE sealed wad %', OLD.id
      USING ERRCODE = 'check_violation',
            HINT = 'Sealed WaDs are append-only; use the admin revoke path instead.';
  END IF;

  -- Sealed row UPDATE: compare every column against the allowlist.
  old_j := to_jsonb(OLD);
  new_j := to_jsonb(NEW);

  FOR k IN SELECT jsonb_object_keys(old_j)
  LOOP
    IF k = ANY(allowlist) THEN
      CONTINUE;
    END IF;
    IF (old_j -> k) IS DISTINCT FROM (new_j -> k) THEN
      RAISE EXCEPTION 'sealed_wad_immutable: column % cannot be changed after seal (wad %)', k, OLD.id
        USING ERRCODE = 'check_violation',
              HINT = 'Sealed WaD metadata is immutable. Only revocation/supersession/certificate fields may change post-seal.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wads_seal_immutability_trg ON public.wads;
CREATE TRIGGER wads_seal_immutability_trg
BEFORE UPDATE OR DELETE ON public.wads
FOR EACH ROW
EXECUTE FUNCTION public.assert_wad_seal_immutability();

COMMENT ON FUNCTION public.assert_wad_seal_immutability() IS
  'C10: once wads.sealed_at IS NOT NULL, only the revocation/supersession/certificate allowlist may change; DELETE is blocked. Fires for all callers including service_role.';