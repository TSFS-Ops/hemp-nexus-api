-- Add archival tracking columns to retention_flags
ALTER TABLE public.retention_flags
ADD COLUMN IF NOT EXISTS archive_storage_path TEXT,
ADD COLUMN IF NOT EXISTS archive_hash TEXT,
ADD COLUMN IF NOT EXISTS archive_size_bytes BIGINT;

-- Index for the archival job: find archived/flagged records efficiently
CREATE INDEX IF NOT EXISTS idx_retention_flags_archive_pending
ON public.retention_flags (retention_status, archived_at)
WHERE retention_status IN ('archived', 'quarantined') AND archive_storage_path IS NULL;

-- Create the archived-records storage bucket (private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
'archived-records',
'archived-records',
false,
52428800, -- 50 MB max per archive file
ARRAY['application/json']
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: service_role only (no authenticated user access)
-- Deny all authenticated access explicitly
DROP POLICY IF EXISTS "No authenticated access to archived records" ON storage.objects;
CREATE POLICY "No authenticated access to archived records"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id != 'archived-records')
WITH CHECK (bucket_id != 'archived-records');
