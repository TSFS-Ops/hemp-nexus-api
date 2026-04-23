-- Create private storage bucket for POI evidence waiver packets.
-- Access is enforced server-side via the waiver-packet edge function (signed URLs).
-- We deliberately disallow direct user reads/writes from the client.

INSERT INTO storage.buckets (id, name, public)
VALUES ('evidence-waiver-packets', 'evidence-waiver-packets', false)
ON CONFLICT (id) DO NOTHING;

-- No RLS policies on storage.objects for this bucket: all access is mediated by
-- the service-role edge function `waiver-packet`, which validates caller
-- authority (match participant or admin/auditor) before issuing a signed URL.
-- This matches our deny-by-default storage posture.
