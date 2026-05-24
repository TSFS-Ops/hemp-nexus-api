-- =========================================================================
-- DATA-005 / DATA-010 Phase 2A — Shared Export Lifecycle
-- Tables: export_requests, export_files, export_jobs
-- Storage: user-exports, admin-exports (private)
-- RPCs: request_user_export, request_admin_export, approve_admin_export,
--       record_export_file, record_export_download, mark_export_file_destroyed,
--       atomic_export_transition
-- =========================================================================

-- 1. ENUM-style CHECKs use text columns (consistent with rest of project).

CREATE TABLE IF NOT EXISTS public.export_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                 text NOT NULL CHECK (kind IN ('user_export', 'admin_export')),
  requester_user_id    uuid NOT NULL,
  subject_user_id      uuid NULL,
  target_org_id        uuid NULL,
  status               text NOT NULL,
  requested_categories text[] NOT NULL DEFAULT '{}',
  resolved_categories  text[] NOT NULL DEFAULT '{}',
  purpose              text NULL,
  reason               text NULL,
  date_range           jsonb NULL,
  verification         jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval             jsonb NOT NULL DEFAULT '{}'::jsonb,
  block_reason         text NULL,
  requested_at         timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- A user export's subject MUST equal the requester (no exporting others).
  CONSTRAINT export_requests_user_subject_self CHECK (
    kind <> 'user_export' OR subject_user_id = requester_user_id
  ),
  -- Admin exports require purpose + reason ≥10 chars.
  CONSTRAINT export_requests_admin_purpose_reason CHECK (
    kind <> 'admin_export' OR (
      purpose IS NOT NULL AND length(coalesce(reason, '')) >= 10
    )
  ),
  -- Status domain (state machine).
  CONSTRAINT export_requests_status_domain CHECK (
    (kind = 'user_export' AND status IN (
      'verification_required',
      'export_preparation_required',
      'ready_for_delivery',
      'delivered',
      'expired',
      'destroyed',
      'blocked_verification_failed',
      'limited_retention_or_confidentiality_required'
    ))
    OR
    (kind = 'admin_export' AND status IN (
      'awaiting_approval',
      'export_preparation_required',
      'ready_for_download',
      'downloaded',
      'expired',
      'destroyed',
      'blocked_or_declined'
    ))
  )
);

CREATE INDEX IF NOT EXISTS export_requests_kind_status_idx
  ON public.export_requests (kind, status);
CREATE INDEX IF NOT EXISTS export_requests_subject_idx
  ON public.export_requests (subject_user_id);
CREATE INDEX IF NOT EXISTS export_requests_requester_idx
  ON public.export_requests (requester_user_id);
CREATE INDEX IF NOT EXISTS export_requests_target_org_idx
  ON public.export_requests (target_org_id);
CREATE INDEX IF NOT EXISTS export_requests_requested_at_idx
  ON public.export_requests (requested_at);

-- Approval integrity: admin export approver must NOT equal requester.
CREATE OR REPLACE FUNCTION public.export_requests_check_self_approval()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approver uuid;
BEGIN
  IF NEW.kind = 'admin_export' AND NEW.approval ? 'approver_user_id' THEN
    approver := (NEW.approval->>'approver_user_id')::uuid;
    IF approver IS NOT NULL AND approver = NEW.requester_user_id THEN
      RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED: admin export approver % cannot equal requester %', approver, NEW.requester_user_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_export_requests_self_approval ON public.export_requests;
CREATE TRIGGER trg_export_requests_self_approval
  BEFORE INSERT OR UPDATE ON public.export_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.export_requests_check_self_approval();

-- 2. export_files ------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.export_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_request_id uuid NOT NULL REFERENCES public.export_requests(id) ON DELETE RESTRICT,
  storage_bucket    text NOT NULL CHECK (storage_bucket IN ('user-exports', 'admin-exports')),
  storage_path      text NOT NULL,
  format            text NOT NULL CHECK (format IN ('csv', 'json', 'zip')),
  byte_size         bigint NOT NULL CHECK (byte_size >= 0),
  sha256            text NOT NULL,
  row_counts        jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  destroyed_at      timestamptz NULL,
  destroy_reason    text NULL,
  downloads         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS export_files_request_idx
  ON public.export_files (export_request_id);
CREATE INDEX IF NOT EXISTS export_files_expires_idx
  ON public.export_files (expires_at) WHERE destroyed_at IS NULL;

-- 3. export_jobs -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.export_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_request_id uuid NOT NULL REFERENCES public.export_requests(id) ON DELETE CASCADE,
  job_kind          text NOT NULL CHECK (job_kind IN ('prepare', 'destroy')),
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts          integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error        text NULL,
  scheduled_for     timestamptz NOT NULL DEFAULT now(),
  started_at        timestamptz NULL,
  finished_at       timestamptz NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS export_jobs_request_idx
  ON public.export_jobs (export_request_id);
CREATE INDEX IF NOT EXISTS export_jobs_status_sched_idx
  ON public.export_jobs (status, scheduled_for);

-- 4. RLS --------------------------------------------------------------

ALTER TABLE public.export_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_files    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_jobs     ENABLE ROW LEVEL SECURITY;

-- export_requests: subject can read own user_export; platform_admin reads admin_export.
DROP POLICY IF EXISTS export_requests_user_select ON public.export_requests;
CREATE POLICY export_requests_user_select ON public.export_requests
  FOR SELECT TO authenticated
  USING (
    (kind = 'user_export' AND subject_user_id = auth.uid())
    OR
    (kind = 'admin_export' AND public.is_admin(auth.uid()))
  );

-- No INSERT / UPDATE / DELETE from clients. All writes via service-role RPCs.

-- export_files: same scoping via parent request.
DROP POLICY IF EXISTS export_files_user_select ON public.export_files;
CREATE POLICY export_files_user_select ON public.export_files
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.export_requests er
      WHERE er.id = export_files.export_request_id
        AND (
          (er.kind = 'user_export' AND er.subject_user_id = auth.uid())
          OR (er.kind = 'admin_export' AND public.is_admin(auth.uid()))
        )
    )
  );

-- export_jobs: platform_admin read-only (operational visibility).
DROP POLICY IF EXISTS export_jobs_admin_select ON public.export_jobs;
CREATE POLICY export_jobs_admin_select ON public.export_jobs
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

-- 5. SECURITY DEFINER RPCs (service_role only) -----------------------

CREATE OR REPLACE FUNCTION public.request_user_export(
  p_subject_user_id uuid,
  p_requested_categories text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.export_requests (
    kind, requester_user_id, subject_user_id, status,
    requested_categories
  ) VALUES (
    'user_export', p_subject_user_id, p_subject_user_id, 'verification_required',
    coalesce(p_requested_categories, '{}')
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_admin_export(
  p_requester_user_id uuid,
  p_subject_user_id   uuid,
  p_target_org_id     uuid,
  p_purpose           text,
  p_reason            text,
  p_date_range        jsonb,
  p_requested_categories text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
BEGIN
  IF p_purpose IS NULL OR length(coalesce(p_reason, '')) < 10 THEN
    RAISE EXCEPTION 'admin_export requires purpose and reason (>=10 chars)'
      USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO public.export_requests (
    kind, requester_user_id, subject_user_id, target_org_id, status,
    requested_categories, purpose, reason, date_range
  ) VALUES (
    'admin_export', p_requester_user_id, p_subject_user_id, p_target_org_id,
    'awaiting_approval',
    coalesce(p_requested_categories, '{}'),
    p_purpose, p_reason, p_date_range
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_admin_export(
  p_request_id      uuid,
  p_approver_user_id uuid,
  p_approval_method text
) RETURNS public.export_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.export_requests;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('export_request:' || p_request_id::text));
  SELECT * INTO rec FROM public.export_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_request not found: %', p_request_id;
  END IF;
  IF rec.kind <> 'admin_export' THEN
    RAISE EXCEPTION 'INVALID_KIND: approve only valid for admin_export';
  END IF;
  IF rec.status <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'INVALID_STATE: cannot approve from %', rec.status;
  END IF;
  IF p_approver_user_id = rec.requester_user_id THEN
    RAISE EXCEPTION 'SELF_APPROVAL_NOT_ALLOWED';
  END IF;
  UPDATE public.export_requests
     SET status = 'export_preparation_required',
         approval = jsonb_build_object(
           'approver_user_id', p_approver_user_id,
           'approved_at', now(),
           'approval_method', coalesce(p_approval_method, 'manual')
         )
   WHERE id = p_request_id
   RETURNING * INTO rec;
  RETURN rec;
END;
$$;

CREATE OR REPLACE FUNCTION public.atomic_export_transition(
  p_request_id     uuid,
  p_expected_from  text,
  p_new_status     text,
  p_patch          jsonb
) RETURNS public.export_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.export_requests;
  new_block_reason text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('export_request:' || p_request_id::text));
  SELECT * INTO rec FROM public.export_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_request not found: %', p_request_id;
  END IF;
  IF rec.status <> p_expected_from THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> % (actual: %)', p_expected_from, p_new_status, rec.status;
  END IF;
  new_block_reason := coalesce(p_patch->>'block_reason', rec.block_reason);
  UPDATE public.export_requests
     SET status = p_new_status,
         block_reason = new_block_reason,
         resolved_categories = COALESCE(
           CASE WHEN p_patch ? 'resolved_categories'
                THEN ARRAY(SELECT jsonb_array_elements_text(p_patch->'resolved_categories'))
                ELSE rec.resolved_categories
           END,
           rec.resolved_categories
         ),
         verification = COALESCE(p_patch->'verification', rec.verification),
         expires_at = COALESCE((p_patch->>'expires_at')::timestamptz, rec.expires_at)
   WHERE id = p_request_id
   RETURNING * INTO rec;
  RETURN rec;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_export_file(
  p_request_id    uuid,
  p_bucket        text,
  p_path          text,
  p_format        text,
  p_byte_size     bigint,
  p_sha256        text,
  p_row_counts    jsonb,
  p_expires_at    timestamptz
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_id uuid;
BEGIN
  INSERT INTO public.export_files (
    export_request_id, storage_bucket, storage_path, format,
    byte_size, sha256, row_counts, expires_at
  ) VALUES (
    p_request_id, p_bucket, p_path, p_format,
    p_byte_size, p_sha256, coalesce(p_row_counts, '{}'::jsonb), p_expires_at
  ) RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_export_download(
  p_file_id uuid,
  p_actor_meta jsonb
) RETURNS public.export_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.export_files;
BEGIN
  UPDATE public.export_files
     SET downloads = downloads || jsonb_build_array(
           jsonb_build_object('at', now()) || coalesce(p_actor_meta, '{}'::jsonb)
         ),
         updated_at = now()
   WHERE id = p_file_id
   RETURNING * INTO rec;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_file not found: %', p_file_id;
  END IF;
  RETURN rec;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_export_file_destroyed(
  p_file_id uuid,
  p_reason  text
) RETURNS public.export_files
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec public.export_files;
BEGIN
  UPDATE public.export_files
     SET destroyed_at = now(),
         destroy_reason = coalesce(p_reason, 'expiry'),
         updated_at = now()
   WHERE id = p_file_id AND destroyed_at IS NULL
   RETURNING * INTO rec;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'export_file not found or already destroyed: %', p_file_id;
  END IF;
  RETURN rec;
END;
$$;

-- 6. SECDEF lockdown — service_role only EXECUTE -----------------------

REVOKE EXECUTE ON FUNCTION public.request_user_export(uuid, text[])             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.request_admin_export(uuid, uuid, uuid, text, text, jsonb, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_admin_export(uuid, uuid, text)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.atomic_export_transition(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_export_file(uuid, text, text, text, bigint, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_export_download(uuid, jsonb)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_export_file_destroyed(uuid, text)        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.request_user_export(uuid, text[])              TO service_role;
GRANT EXECUTE ON FUNCTION public.request_admin_export(uuid, uuid, uuid, text, text, jsonb, text[])  TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_admin_export(uuid, uuid, text)         TO service_role;
GRANT EXECUTE ON FUNCTION public.atomic_export_transition(uuid, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_export_file(uuid, text, text, text, bigint, text, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_export_download(uuid, jsonb)            TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_export_file_destroyed(uuid, text)         TO service_role;

-- 7. Storage: private buckets + deny-all RLS for non-service callers --

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-exports',  'user-exports',  false),
       ('admin-exports', 'admin-exports', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Explicit deny: no authenticated read / write / list / delete on these buckets.
-- All access goes through service_role via export-download (signed URL).
DROP POLICY IF EXISTS export_buckets_deny_authenticated_select ON storage.objects;
CREATE POLICY export_buckets_deny_authenticated_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id NOT IN ('user-exports', 'admin-exports'));

DROP POLICY IF EXISTS export_buckets_deny_authenticated_insert ON storage.objects;
CREATE POLICY export_buckets_deny_authenticated_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id NOT IN ('user-exports', 'admin-exports'));

DROP POLICY IF EXISTS export_buckets_deny_authenticated_update ON storage.objects;
CREATE POLICY export_buckets_deny_authenticated_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id NOT IN ('user-exports', 'admin-exports'));

DROP POLICY IF EXISTS export_buckets_deny_authenticated_delete ON storage.objects;
CREATE POLICY export_buckets_deny_authenticated_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id NOT IN ('user-exports', 'admin-exports'));
