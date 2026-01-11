-- Create storage bucket for match documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('match-documents', 'match-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for match-documents bucket
-- Allow users to view documents for their org's matches
CREATE POLICY "Users can view their org match documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'match-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT m.org_id::text 
    FROM public.matches m 
    WHERE m.org_id IN (
      SELECT p.org_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  )
);

-- Allow users to upload documents to their org's matches
CREATE POLICY "Users can upload match documents to their org"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'match-documents'
  AND (storage.foldername(name))[1] IN (
    SELECT p.org_id::text FROM public.profiles p WHERE p.id = auth.uid()
  )
);

-- Allow admins full access
CREATE POLICY "Admins can manage all match documents"
ON storage.objects FOR ALL
USING (
  bucket_id = 'match-documents'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
)
WITH CHECK (
  bucket_id = 'match-documents'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
);