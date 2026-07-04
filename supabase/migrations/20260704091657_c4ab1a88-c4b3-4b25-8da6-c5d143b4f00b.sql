-- Batch V-UI: persist user-visible IDV resubmission intents so the
-- status widget can show the correct messaging on subsequent visits.

CREATE TABLE public.idv_resubmit_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  subject_id uuid REFERENCES public.p5scr_subjects(id) ON DELETE SET NULL,
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'status_widget',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idv_resubmit_intents_reason_chk CHECK (
    reason IN (
      'retry_required',
      'alternative_document_required',
      'failed',
      'expired',
      'error',
      'provider_error',
      'user_initiated'
    )
  ),
  CONSTRAINT idv_resubmit_intents_source_chk CHECK (
    source IN ('status_widget', 'start_screen', 'admin', 'system')
  )
);

CREATE INDEX idv_resubmit_intents_user_idx
  ON public.idv_resubmit_intents (user_id, created_at DESC);

GRANT SELECT ON public.idv_resubmit_intents TO authenticated;
GRANT ALL ON public.idv_resubmit_intents TO service_role;

ALTER TABLE public.idv_resubmit_intents ENABLE ROW LEVEL SECURITY;

-- Users may read only their own resubmission intents.
CREATE POLICY "idv_resubmit_intents_owner_read"
  ON public.idv_resubmit_intents
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Platform admins can read all for support / triage.
CREATE POLICY "idv_resubmit_intents_admin_read"
  ON public.idv_resubmit_intents
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'platform_admin'::app_role));

-- Only service_role (edge functions) may insert; no user-side writes.
-- (No INSERT/UPDATE/DELETE policies for authenticated → denied by RLS.)
