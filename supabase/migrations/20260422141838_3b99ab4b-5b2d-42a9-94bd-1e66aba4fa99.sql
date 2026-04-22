-- Drop orphan policies referencing a non-existent compliance-documents bucket.
-- The bucket itself is not present in storage.buckets; these policies were
-- residue from a feature that never landed.
DROP POLICY IF EXISTS "Auditors can view all compliance docs" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload compliance docs for their org" ON storage.objects;
DROP POLICY IF EXISTS "Users can view their org's compliance docs" ON storage.objects;
