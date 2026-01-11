-- Add verification fields to match_documents table
ALTER TABLE public.match_documents 
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Create index for verified documents lookup
CREATE INDEX IF NOT EXISTS idx_match_documents_verified 
ON public.match_documents(match_id, verified_at) 
WHERE verified_at IS NOT NULL;

-- Update RLS policy to allow admins to update documents for verification
CREATE POLICY "Admins can update any match documents for verification"
ON public.match_documents
FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'::public.app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));