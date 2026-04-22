-- Admin-only reviewer support notes for POI engagements.
-- Distinct from `admin_notes` (which is internal triage notes shared across the
-- engagement lifecycle). `support_notes` captures reviewer/support-desk context
-- about outreach quality, contact difficulties, sanction concerns, etc.
ALTER TABLE public.poi_engagements
  ADD COLUMN IF NOT EXISTS support_notes TEXT,
  ADD COLUMN IF NOT EXISTS support_notes_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS support_notes_updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.poi_engagements.support_notes IS
  'Admin/reviewer-only support desk notes. Visible only to platform_admin role; never exposed to counterparties or initiators.';