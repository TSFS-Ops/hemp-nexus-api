
-- ============================================================
-- P012 — Unknown-counterparty user-facing timeline overlay
-- Projection layer over existing facilitation_cases
-- ============================================================

-- 1. Overlay table (1-to-1 with facilitation_cases)
CREATE TABLE public.unknown_cp_case_overlays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facilitation_case_id uuid NOT NULL UNIQUE REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  poi_id uuid NULL,
  user_facing_status text NOT NULL DEFAULT 'poi_created' CHECK (user_facing_status IN (
    'poi_created','facilitation_case_opened','details_under_review',
    'more_information_required','additional_information_received',
    'outreach_prepared','outreach_started','awaiting_counterparty_response',
    'counterparty_invited','counterparty_onboarding_in_progress',
    'converted_to_known_counterparty','counterparty_declined','no_response',
    'unreachable','invalid_counterparty_details','cancelled_by_requester',
    'closed_by_izenzo'
  )),
  status_group text NOT NULL DEFAULT 'open' CHECK (status_group IN ('open','awaiting','outcome','closed')),
  reopen_allowed boolean NOT NULL DEFAULT false,
  is_overdue_review boolean NOT NULL DEFAULT false,
  is_overdue_outreach boolean NOT NULL DEFAULT false,
  is_escalated_internal boolean NOT NULL DEFAULT false,
  outcome_reason_code text NULL,
  closure_reason_code text NULL,
  known_counterparty_id uuid NULL,
  visibility_version integer NOT NULL DEFAULT 1,
  reopened_at timestamptz NULL,
  reopened_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.unknown_cp_case_overlays TO authenticated;
GRANT ALL ON public.unknown_cp_case_overlays TO service_role;

ALTER TABLE public.unknown_cp_case_overlays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucp_overlay_select_own"
ON public.unknown_cp_case_overlays
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = facilitation_case_id
      AND fc.requesting_user_id = auth.uid()
  )
  OR public.has_role(auth.uid(), 'platform_admin')
);

CREATE INDEX idx_ucp_overlay_case ON public.unknown_cp_case_overlays(facilitation_case_id);
CREATE INDEX idx_ucp_overlay_status ON public.unknown_cp_case_overlays(user_facing_status);

-- 2. Timeline events (user-safe projection)
CREATE TABLE public.unknown_cp_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facilitation_case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  poi_id uuid NULL,
  previous_status text NULL,
  new_status text NOT NULL,
  status_label text NOT NULL,
  user_visible boolean NOT NULL DEFAULT true,
  user_facing_copy text NOT NULL,
  internal_note text NULL,
  reason_code text NULL,
  actor_id uuid NULL,
  actor_role text NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('system','requester','admin','platform_admin')),
  source text NOT NULL,
  audit_event_name text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  timestamp_utc timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.unknown_cp_timeline_events TO authenticated;
GRANT ALL ON public.unknown_cp_timeline_events TO service_role;

ALTER TABLE public.unknown_cp_timeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucp_timeline_select_visible_own"
ON public.unknown_cp_timeline_events
FOR SELECT TO authenticated
USING (
  (
    user_visible = true
    AND EXISTS (
      SELECT 1 FROM public.facilitation_cases fc
      WHERE fc.id = facilitation_case_id
        AND fc.requesting_user_id = auth.uid()
    )
  )
  OR public.has_role(auth.uid(), 'platform_admin')
);

CREATE INDEX idx_ucp_timeline_case ON public.unknown_cp_timeline_events(facilitation_case_id, timestamp_utc DESC);

-- 3. Requester messages
CREATE TABLE public.unknown_cp_user_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facilitation_case_id uuid NOT NULL REFERENCES public.facilitation_cases(id) ON DELETE CASCADE,
  poi_id uuid NULL,
  requester_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  message_category text NOT NULL CHECK (message_category IN (
    'corrected_details','supporting_document','urgency','cancellation_question',
    'contact_support','cancel_request','other'
  )),
  message_body text NOT NULL CHECK (char_length(message_body) >= 20),
  visibility text NOT NULL DEFAULT 'admin_only' CHECK (visibility IN ('admin_only','requester_visible')),
  attachment_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  sent_to_support boolean NOT NULL DEFAULT false,
  support_email_delivery_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.unknown_cp_user_messages TO authenticated;
GRANT ALL ON public.unknown_cp_user_messages TO service_role;

ALTER TABLE public.unknown_cp_user_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ucp_msg_select_own"
ON public.unknown_cp_user_messages
FOR SELECT TO authenticated
USING (
  requester_user_id = auth.uid()
  OR public.has_role(auth.uid(), 'platform_admin')
);

CREATE POLICY "ucp_msg_insert_own"
ON public.unknown_cp_user_messages
FOR INSERT TO authenticated
WITH CHECK (
  requester_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.facilitation_cases fc
    WHERE fc.id = facilitation_case_id
      AND fc.requesting_user_id = auth.uid()
  )
);

CREATE INDEX idx_ucp_msg_case ON public.unknown_cp_user_messages(facilitation_case_id, created_at DESC);

-- 4. updated_at trigger
CREATE TRIGGER trg_ucp_overlay_updated_at
BEFORE UPDATE ON public.unknown_cp_case_overlays
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
