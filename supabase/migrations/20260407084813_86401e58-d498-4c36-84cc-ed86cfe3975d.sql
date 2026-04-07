-- Jurisdiction selections — records the user's chosen documentary/WaD jurisdiction path
CREATE TABLE public.jurisdiction_selections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  selected_jurisdiction TEXT NOT NULL,
  surfaced_jurisdictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  selection_method TEXT NOT NULL DEFAULT 'user_choice',
  escalation_reason TEXT,
  selected_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT valid_selection_method CHECK (selection_method IN ('auto', 'user_choice', 'escalated'))
);

-- One selection per match per org
CREATE UNIQUE INDEX idx_jurisdiction_selections_match_org ON public.jurisdiction_selections (match_id, org_id);

-- Enable RLS
ALTER TABLE public.jurisdiction_selections ENABLE ROW LEVEL SECURITY;

-- Match participants can view
CREATE POLICY "Match participants can view jurisdiction selections"
  ON public.jurisdiction_selections
  FOR SELECT
  TO authenticated
  USING (public.is_match_participant(auth.uid(), match_id));

-- Match participants can create
CREATE POLICY "Match participants can create jurisdiction selections"
  ON public.jurisdiction_selections
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_match_participant(auth.uid(), match_id));

-- Admins can view all
CREATE POLICY "Admins can view all jurisdiction selections"
  ON public.jurisdiction_selections
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));