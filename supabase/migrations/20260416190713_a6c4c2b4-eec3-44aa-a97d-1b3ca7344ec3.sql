-- Add selected_persona to profiles for first-login fork
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS selected_persona text
  CHECK (selected_persona IN ('trade','developer','governance'));

CREATE INDEX IF NOT EXISTS idx_profiles_selected_persona
  ON public.profiles(selected_persona)
  WHERE selected_persona IS NOT NULL;

COMMENT ON COLUMN public.profiles.selected_persona IS
  'User-chosen surface after first login: trade | developer | governance. NULL means user has not yet picked.';