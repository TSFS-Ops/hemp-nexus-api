-- ================================================================
-- Upload Docs Feature: Complete Database Schema Changes
-- ================================================================

-- 1. Extend matches table with buyer/seller org tracking
ALTER TABLE public.matches 
ADD COLUMN IF NOT EXISTS buyer_org_id UUID REFERENCES organizations(id),
ADD COLUMN IF NOT EXISTS seller_org_id UUID REFERENCES organizations(id);

-- Create index for efficient counterparty lookups
CREATE INDEX IF NOT EXISTS idx_matches_buyer_org ON public.matches(buyer_org_id);
CREATE INDEX IF NOT EXISTS idx_matches_seller_org ON public.matches(seller_org_id);

-- 2. Extend match_documents table with visibility, metadata, and soft-delete fields
ALTER TABLE public.match_documents
ADD COLUMN IF NOT EXISTS title TEXT,
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
ADD COLUMN IF NOT EXISTS valid_from TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS valid_to TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
ADD COLUMN IF NOT EXISTS supersedes_document_id UUID REFERENCES match_documents(id),
ADD COLUMN IF NOT EXISTS uploader_org_id UUID REFERENCES organizations(id);

-- Add visibility constraint
ALTER TABLE public.match_documents 
DROP CONSTRAINT IF EXISTS match_documents_visibility_check;
ALTER TABLE public.match_documents
ADD CONSTRAINT match_documents_visibility_check 
  CHECK (visibility IN ('private', 'share_with_counterparty', 'share_with_roles'));

-- Update status to include soft-delete states
-- First drop existing constraint if it exists
DO $$
BEGIN
  ALTER TABLE public.match_documents DROP CONSTRAINT IF EXISTS match_documents_status_check;
EXCEPTION
  WHEN undefined_object THEN NULL;
END $$;

-- Add new constraint with expanded status options
ALTER TABLE public.match_documents
ADD CONSTRAINT match_documents_status_check 
  CHECK (status IN ('uploaded', 'pending_review', 'accepted', 'rejected', 'verified', 'revoked', 'archived', 'expired'));

-- Create index for visibility-based queries
CREATE INDEX IF NOT EXISTS idx_match_documents_visibility ON public.match_documents(visibility);
CREATE INDEX IF NOT EXISTS idx_match_documents_uploader_org ON public.match_documents(uploader_org_id);
CREATE INDEX IF NOT EXISTS idx_match_documents_status ON public.match_documents(status);

-- 3. Create document_access table for explicit access grants
CREATE TABLE IF NOT EXISTS public.document_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES match_documents(id) ON DELETE CASCADE,
  granted_to_org_id UUID REFERENCES organizations(id),
  granted_to_user_id UUID,
  granted_by_user_id UUID NOT NULL,
  access_type TEXT NOT NULL DEFAULT 'view' CHECK (access_type IN ('view', 'download')),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- At least one grantee required
  CHECK (granted_to_org_id IS NOT NULL OR granted_to_user_id IS NOT NULL)
);

-- Create indexes for document_access
CREATE INDEX IF NOT EXISTS idx_document_access_document ON public.document_access(document_id);
CREATE INDEX IF NOT EXISTS idx_document_access_org ON public.document_access(granted_to_org_id);
CREATE INDEX IF NOT EXISTS idx_document_access_user ON public.document_access(granted_to_user_id);
CREATE INDEX IF NOT EXISTS idx_document_access_active ON public.document_access(document_id) WHERE revoked_at IS NULL;

-- Enable RLS on document_access
ALTER TABLE public.document_access ENABLE ROW LEVEL SECURITY;

-- 4. Create document_access_logs table for admin access auditing
CREATE TABLE IF NOT EXISTS public.document_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES match_documents(id),
  match_id UUID NOT NULL REFERENCES matches(id),
  accessor_user_id UUID NOT NULL,
  accessor_org_id UUID REFERENCES organizations(id),
  action TEXT NOT NULL CHECK (action IN ('view', 'download', 'share', 'revoke', 'visibility_change')),
  access_reason TEXT,
  is_admin_access BOOLEAN NOT NULL DEFAULT false,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for document_access_logs
CREATE INDEX IF NOT EXISTS idx_doc_access_logs_document ON public.document_access_logs(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_access_logs_match ON public.document_access_logs(match_id);
CREATE INDEX IF NOT EXISTS idx_doc_access_logs_accessor ON public.document_access_logs(accessor_user_id);
CREATE INDEX IF NOT EXISTS idx_doc_access_logs_created ON public.document_access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_access_logs_admin ON public.document_access_logs(is_admin_access) WHERE is_admin_access = true;

-- Enable RLS on document_access_logs
ALTER TABLE public.document_access_logs ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies for document_access table
CREATE POLICY "Users can view access grants for their documents"
ON public.document_access FOR SELECT
USING (
  -- Document uploader can see all grants
  document_id IN (
    SELECT id FROM match_documents 
    WHERE uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
  OR
  -- Grantee can see their own grants
  granted_to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR
  granted_to_user_id = auth.uid()
  OR
  -- Admin access
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Users can create access grants for their documents"
ON public.document_access FOR INSERT
WITH CHECK (
  granted_by_user_id = auth.uid()
  AND document_id IN (
    SELECT id FROM match_documents 
    WHERE uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
);

CREATE POLICY "Users can revoke access grants they created"
ON public.document_access FOR UPDATE
USING (
  granted_by_user_id = auth.uid()
  OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Service role can manage document access"
ON public.document_access FOR ALL
USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text)
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- 6. RLS Policies for document_access_logs table
CREATE POLICY "Users can view their own access logs"
ON public.document_access_logs FOR SELECT
USING (
  accessor_user_id = auth.uid()
  OR
  -- Document uploader can see access logs for their docs
  document_id IN (
    SELECT id FROM match_documents 
    WHERE uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
  OR
  has_role(auth.uid(), 'admin'::app_role)
);

CREATE POLICY "Service role can insert access logs"
ON public.document_access_logs FOR INSERT
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "Admins can view all access logs"
ON public.document_access_logs FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Update match_documents RLS policies for visibility-based access
-- Drop existing policies that need updating
DROP POLICY IF EXISTS "Users can view their org's match documents" ON public.match_documents;

-- New comprehensive visibility policy
CREATE POLICY "Document visibility based on ownership and sharing"
ON public.match_documents FOR SELECT
USING (
  -- Case 1: Uploader's org always sees their docs (status not revoked for non-uploaders)
  (uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()))
  OR
  -- Case 2: Match creator org (legacy support)
  (org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()) AND status NOT IN ('revoked', 'archived'))
  OR
  -- Case 3: Counterparty visibility for shared docs (not revoked)
  (
    visibility = 'share_with_counterparty'
    AND status NOT IN ('revoked', 'archived')
    AND match_id IN (
      SELECT id FROM matches m
      WHERE (m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
             OR m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()))
    )
  )
  OR
  -- Case 4: Explicit access grants (not revoked)
  (
    visibility = 'share_with_roles'
    AND status NOT IN ('revoked', 'archived')
    AND id IN (
      SELECT document_id FROM document_access da
      WHERE da.revoked_at IS NULL
        AND (
          da.granted_to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
          OR da.granted_to_user_id = auth.uid()
        )
    )
  )
  OR
  -- Case 5: Admin access (can see all including revoked)
  has_role(auth.uid(), 'admin'::app_role)
);

-- Update insert policy for POI participants
DROP POLICY IF EXISTS "Users can upload documents to their org's matches" ON public.match_documents;

CREATE POLICY "Users can upload documents to POI they participate in"
ON public.match_documents FOR INSERT
WITH CHECK (
  -- Match creator org
  org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR
  -- Buyer org
  match_id IN (
    SELECT id FROM matches m
    WHERE m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
  OR
  -- Seller org
  match_id IN (
    SELECT id FROM matches m
    WHERE m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
);

-- Update policy for document updates (visibility, status changes)
DROP POLICY IF EXISTS "Admins can update any match documents for verification" ON public.match_documents;

CREATE POLICY "Users can update their own documents"
ON public.match_documents FOR UPDATE
USING (
  uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
)
WITH CHECK (
  uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
);

-- 8. Update storage bucket policies for visibility-aware access
-- Note: Storage policies reference match_documents visibility

-- First ensure the bucket exists with correct settings
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'match-documents', 
  'match-documents', 
  false,
  52428800,  -- 50MB limit
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Drop existing storage policies if they exist
DROP POLICY IF EXISTS "Users can upload match documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their org match documents" ON storage.objects;
DROP POLICY IF EXISTS "Document storage visibility" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload match documents" ON storage.objects;

-- Create new storage policies aligned with document visibility
CREATE POLICY "Upload match documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'match-documents'
  AND auth.uid() IS NOT NULL
);

CREATE POLICY "View match documents based on visibility"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'match-documents'
  AND (
    -- Check if user has access via match_documents RLS
    EXISTS (
      SELECT 1 FROM match_documents md
      WHERE md.storage_path = name
      AND (
        -- Uploader's org
        md.uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
        OR
        -- Match creator org
        md.org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
        OR
        -- Counterparty with shared access
        (
          md.visibility = 'share_with_counterparty'
          AND md.status NOT IN ('revoked', 'archived')
          AND md.match_id IN (
            SELECT id FROM matches m
            WHERE m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
               OR m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
          )
        )
        OR
        -- Explicit role-based access
        (
          md.visibility = 'share_with_roles'
          AND md.status NOT IN ('revoked', 'archived')
          AND md.id IN (
            SELECT document_id FROM document_access
            WHERE revoked_at IS NULL
              AND (granted_to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
                   OR granted_to_user_id = auth.uid())
          )
        )
        OR
        -- Admin access
        has_role(auth.uid(), 'admin'::app_role)
      )
    )
  )
);

-- 9. Backfill uploader_org_id from org_id for existing documents
UPDATE public.match_documents
SET uploader_org_id = org_id
WHERE uploader_org_id IS NULL;