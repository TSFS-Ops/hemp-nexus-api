-- Facilitation Batch 12 — Admin Notification Template Editor.
-- Adds version-lineage column + submitted-for-approval markers to the
-- existing facilitation_outreach_templates table.
-- No destructive changes. Existing rows unaffected.

ALTER TABLE public.facilitation_outreach_templates
  ADD COLUMN IF NOT EXISTS previous_template_id uuid
    REFERENCES public.facilitation_outreach_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_for_approval_by uuid
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS fot_previous_template_idx
  ON public.facilitation_outreach_templates(previous_template_id);
