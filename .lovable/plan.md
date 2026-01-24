
# Upload Docs Feature Implementation Plan

## Executive Summary

This plan implements a comprehensive document management system for POI (Proof-of-Intent) records, aligned with the "Upload Docs Spec.pdf" and David's clarifications from 24 Jan 2026. The implementation adds visibility controls (private/counterparty/role-based), soft-delete/revoke semantics, admin access logging with required reasons, and integrates with the existing audit trail.

---

## Current State Analysis

### Existing Infrastructure
- **`match_documents` table**: Already exists with basic fields (id, match_id, org_id, uploader_user_id, doc_type, filename, storage_path, sha256_hash, file_size, mime_type, status, created_at)
- **`match-documents` storage bucket**: Private bucket with org-scoped RLS policies
- **`MatchDocuments` component**: Basic upload/download UI on match detail page
- **`AdminDocumentVerification` component**: Admin panel for document verification
- **Audit logging**: `audit_logs` and `admin_audit_logs` tables exist

### Key Gaps vs. Spec
1. **Missing visibility controls**: No `visibility` field or `document_access` table for counterparty sharing
2. **No buyer/seller org tracking on matches**: Current `matches` table only has single `org_id`, not `buyer_org_id`/`seller_org_id`
3. **Missing metadata fields**: `title`, `notes`, `valid_from`, `valid_to`, versioning
4. **No soft-delete semantics**: Current status enum lacks `revoked`/`archived`
5. **Admin access logging**: No required "access reason" for admin downloads
6. **RLS doesn't support counterparty visibility**: Current policies are org-only

---

## Architecture Design

### Visibility Model

```text
+------------------+     +----------------------+     +------------------+
|  match_documents |---->|  document_access     |---->|  profiles        |
+------------------+     +----------------------+     +------------------+
| id               |     | id                   |     | id               |
| match_id         |     | document_id          |     | org_id           |
| uploader_org_id  |     | granted_to_org_id    |     +------------------+
| visibility       |     | granted_to_user_id   |
| status           |     | granted_by_user_id   |
| ...              |     | access_type          |
+------------------+     | created_at           |
                         | revoked_at           |
                         +----------------------+
```

### Visibility Modes
1. **`private`**: Only uploader's org can view
2. **`share_with_counterparty`**: Both buyer and seller orgs can view
3. **`share_with_roles`**: Explicit access grants via `document_access` table

---

## Implementation Details

### Phase 1: Database Schema Changes

#### 1.1 Extend `matches` Table
Add buyer/seller org tracking to enable counterparty visibility:

```sql
ALTER TABLE public.matches 
ADD COLUMN buyer_org_id UUID REFERENCES organizations(id),
ADD COLUMN seller_org_id UUID REFERENCES organizations(id);
```

#### 1.2 Extend `match_documents` Table
Add visibility, metadata, and soft-delete fields:

```sql
ALTER TABLE public.match_documents
ADD COLUMN title TEXT,
ADD COLUMN notes TEXT,
ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private' 
  CHECK (visibility IN ('private', 'share_with_counterparty', 'share_with_roles')),
ADD COLUMN valid_from TIMESTAMP WITH TIME ZONE,
ADD COLUMN valid_to TIMESTAMP WITH TIME ZONE,
ADD COLUMN version INTEGER NOT NULL DEFAULT 1,
ADD COLUMN supersedes_document_id UUID REFERENCES match_documents(id),
ADD COLUMN uploader_org_id UUID REFERENCES organizations(id);

-- Extend status enum for soft-delete
ALTER TABLE public.match_documents 
DROP CONSTRAINT IF EXISTS match_documents_status_check;
ALTER TABLE public.match_documents
ADD CONSTRAINT match_documents_status_check 
  CHECK (status IN ('uploaded', 'pending_review', 'accepted', 'rejected', 'verified', 'revoked', 'archived', 'expired'));
```

#### 1.3 Create `document_access` Table
For explicit access grants (role-based sharing):

```sql
CREATE TABLE public.document_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES match_documents(id) ON DELETE CASCADE,
  granted_to_org_id UUID REFERENCES organizations(id),
  granted_to_user_id UUID REFERENCES profiles(id),
  granted_by_user_id UUID NOT NULL REFERENCES profiles(id),
  access_type TEXT NOT NULL DEFAULT 'view' CHECK (access_type IN ('view', 'download')),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by_user_id UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- At least one grantee required
  CHECK (granted_to_org_id IS NOT NULL OR granted_to_user_id IS NOT NULL)
);

CREATE INDEX idx_document_access_document ON document_access(document_id);
CREATE INDEX idx_document_access_org ON document_access(granted_to_org_id);
CREATE INDEX idx_document_access_user ON document_access(granted_to_user_id);

ALTER TABLE document_access ENABLE ROW LEVEL SECURITY;
```

#### 1.4 Create `document_access_logs` Table
For admin access with required reasons:

```sql
CREATE TABLE public.document_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES match_documents(id),
  match_id UUID NOT NULL REFERENCES matches(id),
  accessor_user_id UUID NOT NULL REFERENCES profiles(id),
  accessor_org_id UUID REFERENCES organizations(id),
  action TEXT NOT NULL CHECK (action IN ('view', 'download')),
  access_reason TEXT,  -- Required for admin access
  is_admin_access BOOLEAN NOT NULL DEFAULT false,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_access_logs_document ON document_access_logs(document_id);
CREATE INDEX idx_doc_access_logs_match ON document_access_logs(match_id);
CREATE INDEX idx_doc_access_logs_created ON document_access_logs(created_at DESC);

ALTER TABLE document_access_logs ENABLE ROW LEVEL SECURITY;
```

#### 1.5 RLS Policies for Document Visibility

```sql
-- Drop existing overly simple policy
DROP POLICY IF EXISTS "Users can view their org's match documents" ON match_documents;

-- New comprehensive visibility policy
CREATE POLICY "Document visibility based on ownership and sharing"
ON public.match_documents FOR SELECT
USING (
  -- Case 1: Uploader's org always sees their docs
  uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  OR
  -- Case 2: Counterparty visibility for shared docs
  (
    visibility = 'share_with_counterparty'
    AND match_id IN (
      SELECT id FROM matches m
      WHERE (m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
             OR m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid()))
    )
  )
  OR
  -- Case 3: Explicit access grants
  (
    visibility = 'share_with_roles'
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
  -- Case 4: Admin access
  has_role(auth.uid(), 'admin'::app_role)
);

-- Restrict uploads to match participants
DROP POLICY IF EXISTS "Users can upload documents to their org's matches" ON match_documents;

CREATE POLICY "Users can upload documents to POI they're party to"
ON public.match_documents FOR INSERT
WITH CHECK (
  match_id IN (
    SELECT id FROM matches m
    WHERE m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
       OR m.org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
  )
);
```

#### 1.6 Storage Bucket Policy Updates
Update storage policies to align with document visibility:

```sql
-- Update storage policy to respect document visibility
DROP POLICY IF EXISTS "Users can view their org match documents" ON storage.objects;

CREATE POLICY "Document storage visibility"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'match-documents'
  AND (
    -- Check if user has access via match_documents RLS
    EXISTS (
      SELECT 1 FROM match_documents md
      WHERE md.storage_path = name
      AND (
        md.uploader_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
        OR (
          md.visibility = 'share_with_counterparty'
          AND md.match_id IN (
            SELECT id FROM matches m
            WHERE m.buyer_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
               OR m.seller_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
          )
        )
        OR (
          md.visibility = 'share_with_roles'
          AND md.id IN (
            SELECT document_id FROM document_access
            WHERE revoked_at IS NULL
              AND (granted_to_org_id IN (SELECT org_id FROM profiles WHERE id = auth.uid())
                   OR granted_to_user_id = auth.uid())
          )
        )
        OR has_role(auth.uid(), 'admin'::app_role)
      )
    )
  )
);
```

### Phase 2: Backend Edge Functions

#### 2.1 Document Upload Enhancement
Modify upload flow to capture visibility and metadata:
- Accept `title`, `notes`, `visibility`, `valid_from`, `valid_to` on upload
- Compute SHA-256 hash server-side for integrity
- Log `document.uploaded` event to audit trail

#### 2.2 Document Download with Signed URLs
Create `/documents/{id}/download` endpoint:
- Generate short-lived signed URL (5-15 minutes)
- Enforce visibility rules
- Log all downloads to `document_access_logs`
- Require `access_reason` for admin downloads

#### 2.3 Visibility Management
Create `/documents/{id}/share` endpoint:
- Allow uploader to change visibility
- Create `document_access` grants for role-based sharing
- Log `document.shared` and `document.visibility_changed` events

#### 2.4 Revoke Access
Create `/documents/{id}/revoke` endpoint:
- Soft-revoke by setting `status = 'revoked'` or revoking specific grants
- Log `document.revoked` event
- Immediately remove counterparty access

### Phase 3: Frontend Components

#### 3.1 Enhanced MatchDocuments Component
Update the existing component at `src/components/match/MatchDocuments.tsx`:
- Add visibility selector on upload (private/counterparty/roles)
- Add title and notes fields
- Add valid_from/valid_to date pickers
- Show visibility column in document list
- Add "Share Settings" action to change visibility
- Add "Revoke Access" action for soft-revoke

#### 3.2 Document Sharing Dialog
New component for managing document access:
- Toggle counterparty visibility
- Add/remove specific role grants
- Show current access list

#### 3.3 Counterparty View
For counterparty users viewing shared documents:
- Show only documents with `share_with_counterparty` or explicit grants
- Read-only view (no upload unless explicitly permitted)
- Download with access logging

#### 3.4 Admin Documents Panel Enhancement
Update `src/components/admin/AdminDocumentVerification.tsx`:
- Add filters for: POI, org, doc type, status, visibility, date
- Add "Access Reason" required field before download
- Show access logs in document detail view
- Add visibility override capability (with audit)

### Phase 4: Audit Trail Integration

#### 4.1 Audit Events
All document actions log to `audit_logs`:
- `document.uploaded` - includes poi_id, doc_id, uploader, visibility
- `document.shared` - includes poi_id, doc_id, actor, target org/user
- `document.visibility_changed` - includes poi_id, doc_id, old/new visibility
- `document.revoked` - includes poi_id, doc_id, actor
- `document.downloaded` - includes poi_id, doc_id, accessor
- `admin.document.accessed` - includes poi_id, doc_id, admin user, access reason

#### 4.2 Evidence Chain Integration
Update `evidence-pack` edge function to include:
- Document list with hashes
- Visibility settings
- Access log history

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `src/components/match/DocumentSharingDialog.tsx` | Dialog for managing document visibility and access grants |
| `src/components/match/DocumentAccessLogs.tsx` | Display access history for a document |
| `supabase/functions/document-download/index.ts` | Signed URL generation with access logging |
| `supabase/functions/document-share/index.ts` | Visibility management endpoint |
| `supabase/functions/document-revoke/index.ts` | Soft-revoke endpoint |

### Modified Files
| File | Changes |
|------|---------|
| `src/components/match/MatchDocuments.tsx` | Add visibility, title, notes fields; sharing/revoke actions |
| `src/components/admin/AdminDocumentVerification.tsx` | Add filters, access reason dialog, access logs view |
| `src/pages/MatchDetails.tsx` | Pass buyer/seller org context to MatchDocuments |
| `supabase/functions/evidence-pack/index.ts` | Include document visibility and access logs |

### Database Migrations
| Migration | Purpose |
|-----------|---------|
| `add_document_visibility_fields.sql` | Extend match_documents with visibility, metadata fields |
| `add_buyer_seller_orgs_to_matches.sql` | Add buyer_org_id, seller_org_id to matches |
| `create_document_access_table.sql` | Create document_access for explicit grants |
| `create_document_access_logs_table.sql` | Create document_access_logs for audit |
| `update_document_rls_policies.sql` | Update RLS for visibility-aware access |
| `update_storage_policies.sql` | Update storage bucket policies |

---

## UI Location

### User-Facing
- **POI Detail Page** (`/dashboard/matches/:matchId`): "Documents" section below match details
  - Upload CTA with visibility selector
  - Document table with visibility, status, actions
  - Share Settings and Revoke Access buttons per document

### Admin Panel
- **Admin > Document Verification** (`/admin/documents`): Enhanced with:
  - Filter bar: POI, org, doc type, status, visibility, date range
  - Access reason modal before download
  - Access logs tab per document

---

## Acceptance Tests

1. **User uploads a doc into a POI** - User sees it immediately under Documents
2. **Counterparty does NOT see it if set to private** - Visibility enforced by RLS
3. **Counterparty DOES see it if shared_with_counterparty** - RLS allows access
4. **Admin sees it regardless** - Admin role bypasses visibility
5. **Admin access is logged** - document_access_logs entry created with reason
6. **Revoke action removes counterparty access immediately** - Document hidden without file deletion
7. **No routes on www.izenzo expose docs or doc metadata** - Public site has no document endpoints

---

## Security Guardrails

1. **RLS Enforcement**: All document access goes through RLS policies
2. **No Hard Deletes**: Status changes only; files remain in storage
3. **Admin Audit Trail**: All admin access requires reason and is logged
4. **Signed URLs**: Downloads use short-lived signed URLs (5 min default)
5. **POI Scoping**: Documents only accessible within POI context
6. **Enumeration Prevention**: No listing documents outside POI scope

---

## Documentation Updates

After implementation:
- Update developer docs explaining "Documents are stored per POI; sharing is explicit; no liability; evidence-grade logging"
- Add changelog entry for this feature
- Update API reference with new endpoints

---

## Technical Notes

### Counterparty Detection Challenge
The current `matches` table only has a single `org_id`. To implement counterparty visibility properly, we need to:
1. Add `buyer_org_id` and `seller_org_id` columns
2. Backfill existing matches (may require manual mapping or lookup from buyer_id/seller_id)
3. Update match creation to capture both org IDs

This is a prerequisite for proper counterparty document sharing.

### Storage Path Format
Following spec recommendation:
```
/poi/<match_id>/<doc_id>/<filename>
```
This ensures documents are grouped by POI for easy management.
