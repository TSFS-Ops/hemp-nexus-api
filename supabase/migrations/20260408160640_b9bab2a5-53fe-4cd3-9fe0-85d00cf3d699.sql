
-- ============================================================
-- Storage Deletion Queue: 30-day POPIA/GDPR compliance hold
-- ============================================================

-- Tombstone queue table
CREATE TABLE public.storage_deletion_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_record_id UUID,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Validation trigger instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_sdq_status()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'processed', 'failed') THEN
    RAISE EXCEPTION 'Invalid status: %. Must be pending, processed, or failed.', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_sdq_status
  BEFORE INSERT OR UPDATE ON public.storage_deletion_queue
  FOR EACH ROW EXECUTE FUNCTION public.validate_sdq_status();

-- Performance index for the cleanup query
CREATE INDEX idx_sdq_pending_scheduled 
  ON public.storage_deletion_queue (scheduled_for) 
  WHERE status = 'pending';

-- RLS: enabled but NO permissive policies = only service_role can access
ALTER TABLE public.storage_deletion_queue ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Intercept triggers: catch orphaned files on DELETE
-- ============================================================

CREATE OR REPLACE FUNCTION public.enqueue_storage_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.storage_path IS NOT NULL AND OLD.storage_path != '' THEN
    INSERT INTO public.storage_deletion_queue (bucket_id, file_path, source_table, source_record_id)
    VALUES (
      TG_ARGV[0],
      OLD.storage_path,
      TG_TABLE_NAME,
      OLD.id
    );
  END IF;
  RETURN OLD;
END;
$$;

-- match_documents → match-documents bucket
CREATE TRIGGER trg_match_documents_cleanup
  AFTER DELETE ON public.match_documents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_storage_deletion('match-documents');

-- kyc_documents → kyc-documents bucket
CREATE TRIGGER trg_kyc_documents_cleanup
  AFTER DELETE ON public.kyc_documents
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_storage_deletion('kyc-documents');
