-- Reversibility: add a column to capture the previous full_name value
-- whenever the system clears it. For the 89 users we already nulled,
-- the previous value was provably equal to their email (that was the
-- WHERE clause of the original backfill), so we can repopulate it here.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name_previous text;

COMMENT ON COLUMN public.profiles.full_name_previous IS
  'Previous value of full_name when it was cleared by the system (e.g. when it was an email pattern). Used for reversibility and audit.';

-- Backfill the previous-value column for the 89 users we nulled.
-- Their old full_name was equal to their email (per the prior WHERE clause).
UPDATE public.profiles
   SET full_name_previous = email
 WHERE full_name IS NULL
   AND full_name_previous IS NULL
   AND email IS NOT NULL;

-- Per-user notification: tell each affected user, in-app, what we did
-- and what they need to do. Done as an INSERT ... SELECT so each user
-- gets exactly one row.
INSERT INTO public.notifications (user_id, org_id, type, title, body, link, read)
SELECT
  p.id,
  p.org_id,
  'profile.legal_name_reset',
  'Action needed: confirm your personal name',
  'We reset the "Full name" field on your profile because it was set to your email address rather than your legal name. Your personal legal name is the signatory on every Proof of Intent, certificate, and compliance record you issue. Please open Desk → Settings → My Profile and enter your full legal name (e.g. "Jane Smith") before your next trade. Your previous value has been preserved on the profile and can be restored on request.',
  '/desk/settings',
  false
FROM public.profiles p
WHERE p.full_name IS NULL
  AND p.full_name_previous IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.notifications n
     WHERE n.user_id = p.id
       AND n.type = 'profile.legal_name_reset'
  );

-- Audit the reversibility upgrade
INSERT INTO public.admin_audit_logs (action, target_type, target_id, details)
VALUES (
  'profiles.full_name.reversibility_added',
  'profiles',
  NULL,
  jsonb_build_object(
    'reason', 'Backfilled full_name_previous for users whose full_name was nulled, and sent each of them an in-app notification.',
    'applied_at', now()
  )
);