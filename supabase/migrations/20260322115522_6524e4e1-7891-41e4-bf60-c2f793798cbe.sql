-- Add version-chain lineage columns to match_documents
ALTER TABLE public.match_documents
  ADD COLUMN IF NOT EXISTS root_document_id UUID REFERENCES public.match_documents(id),
  ADD COLUMN IF NOT EXISTS is_current_version BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS change_notes TEXT;

-- Backfill: any document with status 'archived' is NOT current
UPDATE public.match_documents
  SET is_current_version = false,
      superseded_at = updated_at
  WHERE status = 'archived' AND is_current_version = true;

-- Backfill: set root_document_id for existing chains
-- For documents that supersede another, trace the chain root
-- First: docs that ARE roots (no supersedes_document_id, or are the first in a chain)
UPDATE public.match_documents
  SET root_document_id = id
  WHERE supersedes_document_id IS NULL AND root_document_id IS NULL;

-- Then: docs that supersede another doc — set root to the superseded doc's root or its own id
UPDATE public.match_documents AS child
  SET root_document_id = COALESCE(parent.root_document_id, parent.id)
  FROM public.match_documents AS parent
  WHERE child.supersedes_document_id = parent.id
    AND child.root_document_id IS NULL;

-- Index for fast chain lookups
CREATE INDEX IF NOT EXISTS idx_match_documents_root_doc ON public.match_documents(root_document_id) WHERE root_document_id IS NOT NULL;

-- Index for current-version filtering
CREATE INDEX IF NOT EXISTS idx_match_documents_current ON public.match_documents(match_id, is_current_version) WHERE is_current_version = true;

-- Unique partial index: at most one current version per root chain per match
-- This prevents two documents in the same chain both being marked current
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_documents_one_current_per_chain
  ON public.match_documents(match_id, root_document_id)
  WHERE is_current_version = true AND root_document_id IS NOT NULL;