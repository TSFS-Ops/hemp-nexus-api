-- Fix RLS policy for match_documents to include org_id ownership path
-- This fixes "Failed to load documents" in one-party POI workflow where buyer_org_id/seller_org_id are NULL

-- Drop the existing policy
DROP POLICY IF EXISTS "Document visibility based on ownership and sharing" ON public.match_documents;

-- Create updated policy that includes org_id as a valid ownership path
CREATE POLICY "Document visibility based on ownership and sharing"
ON public.match_documents
FOR SELECT
USING (
  -- 1. Document uploader can always see their documents
  (uploader_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
  
  -- 2. Match org owner can see documents (fixes one-party POI workflow)
  OR (
    (org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid()))
    AND (status NOT IN ('revoked', 'archived'))
  )
  
  -- 3. Match buyer/seller orgs can see non-revoked documents
  OR (
    (match_id IN (
      SELECT m.id FROM matches m 
      WHERE m.org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
    ))
    AND (status NOT IN ('revoked', 'archived'))
  )
  
  -- 4. Counterparty sharing - both buyer and seller can view shared docs
  OR (
    (visibility = 'share_with_counterparty')
    AND (status NOT IN ('revoked', 'archived'))
    AND (match_id IN (
      SELECT m.id FROM matches m
      WHERE (
        m.buyer_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
        OR m.seller_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
      )
    ))
  )
  
  -- 5. Role-based sharing via document_access grants
  OR (
    (visibility = 'share_with_roles')
    AND (status NOT IN ('revoked', 'archived'))
    AND (id IN (
      SELECT da.document_id FROM document_access da
      WHERE da.revoked_at IS NULL
      AND (
        da.granted_to_org_id IN (SELECT profiles.org_id FROM profiles WHERE profiles.id = auth.uid())
        OR da.granted_to_user_id = auth.uid()
      )
    ))
  )
  
  -- 6. Admins can see all documents
  OR has_role(auth.uid(), 'admin'::app_role)
);