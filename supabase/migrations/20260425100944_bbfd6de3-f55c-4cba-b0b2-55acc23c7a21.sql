ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS deletion_reason text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_status_check
  CHECK (status = ANY (ARRAY['active'::text, 'inactive'::text, 'pending_deletion'::text]));

CREATE INDEX IF NOT EXISTS idx_profiles_deletion_requested_at
  ON public.profiles (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;