-- Per-user, per-match UI preferences (e.g., active sub-tab in the Deal Wizard).
-- Strict org-scoped isolation: users can only read/write their own preferences.
CREATE TABLE public.match_ui_prefs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  sub_tab TEXT NOT NULL DEFAULT 'terms',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, match_id),
  CONSTRAINT match_ui_prefs_sub_tab_check CHECK (sub_tab IN ('terms', 'documents', 'notes'))
);

CREATE INDEX idx_match_ui_prefs_user_match ON public.match_ui_prefs (user_id, match_id);

ALTER TABLE public.match_ui_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own match UI prefs"
ON public.match_ui_prefs FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own match UI prefs"
ON public.match_ui_prefs FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own match UI prefs"
ON public.match_ui_prefs FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own match UI prefs"
ON public.match_ui_prefs FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_match_ui_prefs_updated_at
BEFORE UPDATE ON public.match_ui_prefs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();