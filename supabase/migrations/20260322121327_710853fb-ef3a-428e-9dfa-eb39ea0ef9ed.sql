
-- Upgrade retention_flags table with enforcement lifecycle columns
ALTER TABLE public.retention_flags
  ADD COLUMN IF NOT EXISTS retention_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS retention_action text,
  ADD COLUMN IF NOT EXISTS enforcement_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS enforcement_applied_by uuid,
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolution_note text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_by uuid,
  ADD COLUMN IF NOT EXISTS enforcement_audit_id uuid,
  ADD COLUMN IF NOT EXISTS last_scan_at timestamptz,
  ADD COLUMN IF NOT EXISTS org_id uuid;

-- Add constraint for valid retention statuses
ALTER TABLE public.retention_flags
  DROP CONSTRAINT IF EXISTS retention_flags_status_check;
ALTER TABLE public.retention_flags
  ADD CONSTRAINT retention_flags_status_check
  CHECK (retention_status IN ('active', 'flagged', 'retained', 'archived', 'quarantined', 'pending_deletion', 'deleted', 'resolved'));

-- Add constraint for valid retention actions
ALTER TABLE public.retention_flags
  DROP CONSTRAINT IF EXISTS retention_flags_action_check;
ALTER TABLE public.retention_flags
  ADD CONSTRAINT retention_flags_action_check
  CHECK (retention_action IS NULL OR retention_action IN ('archive', 'quarantine', 'mark_readonly', 'schedule_deletion', 'retain', 'no_action'));

-- Add constraint for valid resolution statuses
ALTER TABLE public.retention_flags
  DROP CONSTRAINT IF EXISTS retention_flags_resolution_check;
ALTER TABLE public.retention_flags
  ADD CONSTRAINT retention_flags_resolution_check
  CHECK (resolution_status IS NULL OR resolution_status IN ('acknowledged', 'extended', 'dismissed', 'completed'));

-- Index for enforcement queries
CREATE INDEX IF NOT EXISTS idx_retention_flags_status ON public.retention_flags (retention_status);
CREATE INDEX IF NOT EXISTS idx_retention_flags_action ON public.retention_flags (retention_action) WHERE retention_action IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_retention_flags_expires ON public.retention_flags (retention_expires_at);

-- Update existing rows: set flag_type mapping to retention_status
UPDATE public.retention_flags
  SET retention_status = CASE
    WHEN flag_type = 'expired' THEN 'flagged'
    WHEN flag_type = 'approaching_expiry' THEN 'active'
    ELSE 'active'
  END
  WHERE retention_status = 'active' AND flag_type = 'expired';
