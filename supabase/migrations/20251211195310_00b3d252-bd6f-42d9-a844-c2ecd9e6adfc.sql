-- Fix overly permissive INSERT policy on data_source_performance
-- Current policy allows ANY authenticated user to insert (WITH CHECK: true)
-- This should be restricted to service_role only

DROP POLICY IF EXISTS "Service role can insert performance data" ON data_source_performance;

CREATE POLICY "Service role can insert performance data" 
ON data_source_performance FOR INSERT
WITH CHECK ((auth.jwt() ->> 'role'::text) = 'service_role'::text);