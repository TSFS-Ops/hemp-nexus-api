-- Phase 6 — Memory & audit hardening (additive guards only)

-- 1) Banned-kind guard on Memory/finality links --------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_block_banned_memory_link_kind()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kind IN (
    'raw_provider_payload','id_image','selfie','biometric',
    'unresolved_possible_match','provider_pending_state','raw_adverse_media'
  ) THEN
    RAISE EXCEPTION 'p5scr: memory link kind % is banned (raw payloads / biometrics / unresolved matches must never be linked into Memory)', NEW.kind
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_block_banned_memory_link_kind() FROM PUBLIC;

DROP TRIGGER IF EXISTS p5scr_memory_link_kind_guard ON public.p5scr_memory_finality_links;
CREATE TRIGGER p5scr_memory_link_kind_guard
BEFORE INSERT OR UPDATE ON public.p5scr_memory_finality_links
FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_banned_memory_link_kind();

-- 2) Banned-key guard on audit-event payloads ---------------------------------
CREATE OR REPLACE FUNCTION public.p5scr_block_banned_audit_payload_keys()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_banned text[] := ARRAY[
    'raw_provider_payload','provider_api_secret','id_image','selfie',
    'biometric_template','match_score','list_name','raw_adverse_media'
  ];
  v_key text;
BEGIN
  IF NEW.payload_admin_only IS NULL THEN
    RETURN NEW;
  END IF;
  FOREACH v_key IN ARRAY v_banned LOOP
    IF NEW.payload_admin_only ? v_key THEN
      RAISE EXCEPTION 'p5scr: audit payload key % is banned', v_key
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.p5scr_block_banned_audit_payload_keys() FROM PUBLIC;

DROP TRIGGER IF EXISTS p5scr_audit_payload_key_guard ON public.p5scr_audit_events;
CREATE TRIGGER p5scr_audit_payload_key_guard
BEFORE INSERT OR UPDATE ON public.p5scr_audit_events
FOR EACH ROW EXECUTE FUNCTION public.p5scr_block_banned_audit_payload_keys();

COMMENT ON FUNCTION public.p5scr_block_banned_memory_link_kind() IS
  'P-5 Screening Phase 6: refuses Memory/finality links whose kind is a banned raw-payload / biometric / unresolved-match category.';
COMMENT ON FUNCTION public.p5scr_block_banned_audit_payload_keys() IS
  'P-5 Screening Phase 6: refuses audit-event payloads containing any SSOT-banned key (raw provider payload, biometric template, match score, list name, etc.).';