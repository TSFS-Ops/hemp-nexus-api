-- Privacy Batch 1 — tighten SELECT RLS on PII-bearing tables.
-- Scope: programme_participants, match_named_contacts.
-- No column changes, no INSERT/UPDATE/DELETE policy changes,
-- no Realtime publication changes, service-role policies untouched.

-- =========================================================
-- 1. programme_participants
-- =========================================================

-- Drop the over-broad "any org member of the owning org" SELECT policy.
DROP POLICY IF EXISTS "Users can view own org participants"
  ON public.programme_participants;

-- Replacement: only org_admin of the owning org OR platform_admin
-- can SELECT full programme_participant rows (which include email/phone).
CREATE POLICY "Org admins and platform admins can view participants"
  ON public.programme_participants
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'platform_admin')
    OR EXISTS (
      SELECT 1
      FROM public.programmes pr
      WHERE pr.id = programme_participants.programme_id
        AND public.is_org_admin(auth.uid(), pr.org_id)
    )
  );

-- =========================================================
-- 2. match_named_contacts
-- =========================================================

-- Drop the over-broad "any org member" SELECT policy.
DROP POLICY IF EXISTS "Org members can view their named contacts"
  ON public.match_named_contacts;

-- Replacement: only org_admin of the owning org OR platform_admin
-- can SELECT named-contact rows (which include contact_email/name).
-- The pre-existing "Platform admins can view all named contacts" and
-- "Service role can read named contacts" / "Service role can write
-- named contacts" policies remain in force and are not modified here.
CREATE POLICY "Org admins can view their named contacts"
  ON public.match_named_contacts
  FOR SELECT
  TO authenticated
  USING (
    public.is_org_admin(auth.uid(), org_id)
  );

COMMENT ON POLICY "Org admins can view their named contacts"
  ON public.match_named_contacts IS
  'Privacy Batch 1: contact_email and contact_name are admin-only PII. '
  'Ordinary org members must not be able to SELECT named-contact rows. '
  'Platform admins use the separate "Platform admins can view all named contacts" policy; '
  'service role uses the separate "Service role can read named contacts" policy.';
