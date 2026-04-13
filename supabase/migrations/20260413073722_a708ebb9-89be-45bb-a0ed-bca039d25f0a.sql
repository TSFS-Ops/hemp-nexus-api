
-- Step 1: Add poi_type column with safe default (all existing rows become 'bilateral')
ALTER TABLE public.pois
ADD COLUMN IF NOT EXISTS poi_type TEXT NOT NULL DEFAULT 'bilateral';

-- Step 2: Make seller_entity_id nullable (buyer remains the declaring party)
ALTER TABLE public.pois
ALTER COLUMN seller_entity_id DROP NOT NULL;

-- Step 3: Constraint - only valid poi_type values
ALTER TABLE public.pois
ADD CONSTRAINT pois_poi_type_check CHECK (poi_type IN ('unilateral', 'bilateral'));

-- Step 4: Safeguard - bilateral POIs must have seller_entity_id, unilateral must NOT
ALTER TABLE public.pois
ADD CONSTRAINT pois_type_seller_consistency CHECK (
  (poi_type = 'bilateral' AND seller_entity_id IS NOT NULL)
  OR (poi_type = 'unilateral' AND seller_entity_id IS NULL)
);

-- Step 5: Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_pois_poi_type ON public.pois (poi_type);
