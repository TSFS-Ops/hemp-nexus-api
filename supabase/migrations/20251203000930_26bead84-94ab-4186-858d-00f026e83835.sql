-- Create table for soft action analytics (non-binding behavioral signals)
-- These are purely for UX improvement and have NO legal meaning

CREATE TABLE IF NOT EXISTS public.behavioral_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  action_type TEXT NOT NULL, -- 'skip', 'maybe_later', 'not_now', 'browse'
  match_id UUID REFERENCES public.matches(id) ON DELETE CASCADE,
  session_id TEXT, -- Anonymous session tracking
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Explicit documentation that this is non-binding
  CONSTRAINT non_binding_action CHECK (action_type IN ('skip', 'maybe_later', 'not_now', 'browse', 'view'))
);

-- Add comment documenting the non-binding nature
COMMENT ON TABLE public.behavioral_signals IS 'Non-binding behavioral analytics. These signals have NO legal meaning and are not included in evidence packs. Only used for UX improvement.';
COMMENT ON COLUMN public.behavioral_signals.action_type IS 'Soft action type - never creates intent or evidence records';

-- Enable RLS
ALTER TABLE public.behavioral_signals ENABLE ROW LEVEL SECURITY;

-- Service role can insert (from edge functions)
CREATE POLICY "Service role can insert behavioral signals"
  ON public.behavioral_signals
  FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Admins can view for analytics
CREATE POLICY "Admins can view behavioral signals"
  ON public.behavioral_signals
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create index for analytics queries
CREATE INDEX idx_behavioral_signals_action_type ON public.behavioral_signals(action_type);
CREATE INDEX idx_behavioral_signals_created_at ON public.behavioral_signals(created_at);
CREATE INDEX idx_behavioral_signals_match_id ON public.behavioral_signals(match_id);