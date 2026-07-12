-- Institutional Funder Evidence Workspace — Pilot readiness fixes
-- (post-Batch 6 forensic audit, additive only)
-- No enum renames. No signature changes to existing Batch 1-6 RPCs.

-- 1) Reproducible bucket creation for funder-evidence-packs.
-- Batch 4 created storage POLICIES that reference this bucket, but no
-- migration ever created the bucket itself, so a fresh deployment would
-- have working RLS policies pointed at a bucket that does not exist,
-- and funder-pack-generate/funder-pack-download would fail at runtime.
INSERT INTO storage.buckets (id, name, public)
VALUES ('funder-evidence-packs', 'funder-evidence-packs', false)
ON CONFLICT (id) DO NOTHING;

-- 2) Tighten public.funder_workspace_notes admin visibility.
-- The Batch 5 policy let any platform_admin SELECT every note row,
-- including internal_note/funder_internal rows. That contradicts the
-- V1 rule that internal funder notes are visible only to the funder
-- organisation itself. Admins must only ever see izenzo_shared rows.
DROP POLICY IF EXISTS "fw_note_admin_select" ON public.funder_workspace_notes;
CREATE POLICY "fw_note_admin_select"
ON public.funder_workspace_notes
FOR SELECT TO authenticated
USING (public.p5b3_is_platform_admin() AND visibility = 'izenzo_shared');
