-- Add expiry and metadata fields to api_keys table
ALTER TABLE public.api_keys 
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS expiry_warning_sent BOOLEAN DEFAULT FALSE;

-- Create index for efficient expiry queries
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON public.api_keys(expires_at) WHERE expires_at IS NOT NULL AND status = 'active';

-- Add retry tracking fields to webhook_deliveries
ALTER TABLE public.webhook_deliveries
ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS max_retries INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS is_dead_letter BOOLEAN DEFAULT FALSE;

-- Create index for retry queries
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON public.webhook_deliveries(next_retry_at) 
WHERE next_retry_at IS NOT NULL AND delivery_attempt < max_retries AND NOT is_dead_letter;

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin(user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_roles.user_id = $1
      AND role = 'admin'
  )
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

-- Add comment
COMMENT ON FUNCTION public.is_admin IS 'Check if a user has admin role. Used for UI-level admin checks and RLS policies.';