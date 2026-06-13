-- Critical platform-wide storage RLS corrective fix.
--
-- Two storage.objects policies were authored as PERMISSIVE with
--   USING (bucket_id <> '<denied-bucket>')
-- intending to DENY access to a specific bucket. Because Postgres OR-combines
-- PERMISSIVE policies, this shape acts as a broad ALLOW on every OTHER bucket,
-- bypassing stricter per-bucket policies (e.g. fevd_select on
-- facilitation-evidence). Converting them to RESTRICTIVE restores the
-- documented intent: those buckets remain denied, and access to every other
-- bucket must be granted by an explicit permissive allow policy.
--
-- No facilitation business logic, POI/WaD/match/token/credit/payment/
-- notification/email/engagement behaviour is touched.

DROP POLICY IF EXISTS "Deny anon/auth on evidence-waiver-packets" ON storage.objects;
CREATE POLICY "Deny anon/auth on evidence-waiver-packets"
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (bucket_id <> 'evidence-waiver-packets')
  WITH CHECK (bucket_id <> 'evidence-waiver-packets');

DROP POLICY IF EXISTS "No authenticated access to archived records" ON storage.objects;
CREATE POLICY "No authenticated access to archived records"
  ON storage.objects
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (bucket_id <> 'archived-records')
  WITH CHECK (bucket_id <> 'archived-records');
