-- Add organization and user context to matches table
ALTER TABLE matches ADD COLUMN org_id UUID REFERENCES organizations(id);
ALTER TABLE matches ADD COLUMN created_by UUID REFERENCES auth.users(id);

-- Update existing matches to have org_id (set to first org for now)
UPDATE matches 
SET org_id = (SELECT id FROM organizations LIMIT 1)
WHERE org_id IS NULL;

-- Make org_id NOT NULL now that existing rows are updated
ALTER TABLE matches ALTER COLUMN org_id SET NOT NULL;

-- Drop existing overly permissive RLS policies
DROP POLICY IF EXISTS "Authenticated users can view matches" ON matches;
DROP POLICY IF EXISTS "Service role can manage all matches" ON matches;

-- Create organization-isolated RLS policies
CREATE POLICY "Users can view their org's matches"
  ON matches FOR SELECT
  USING (org_id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can create matches for their org"
  ON matches FOR INSERT
  WITH CHECK (org_id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Users can update their org's matches"
  ON matches FOR UPDATE
  USING (org_id IN (
    SELECT org_id FROM profiles WHERE id = auth.uid()
  ));

CREATE POLICY "Service role can manage all matches"
  ON matches FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role')
  WITH CHECK (auth.jwt() ->> 'role' = 'service_role');