-- Add match_type column to distinguish record types
ALTER TABLE public.matches 
ADD COLUMN match_type text NOT NULL DEFAULT 'search';

-- Add index for filtering by type
CREATE INDEX idx_matches_match_type ON public.matches (match_type);

-- Make seller_id and seller_name nullable for unilateral intents
ALTER TABLE public.matches ALTER COLUMN seller_id DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN seller_name DROP NOT NULL;

-- Also make buyer_id and buyer_name nullable (for unilateral seller-side intents)
ALTER TABLE public.matches ALTER COLUMN buyer_id DROP NOT NULL;
ALTER TABLE public.matches ALTER COLUMN buyer_name DROP NOT NULL;