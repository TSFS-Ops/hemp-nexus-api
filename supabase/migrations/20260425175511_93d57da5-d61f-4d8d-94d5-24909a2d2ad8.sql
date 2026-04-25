UPDATE public.profiles
SET org_id = '03ac6e2c-fbb8-4593-b619-cb752a175fff'
WHERE id = '6725d3bd-300d-451d-b742-75664c46b768';

DELETE FROM public.organizations
WHERE id = '97397920-a0a5-42f1-be28-59e5927fa2e8';

DELETE FROM public.user_roles
WHERE user_id = '6725d3bd-300d-451d-b742-75664c46b768'
  AND role = 'org_admin';

UPDATE auth.users
SET email_confirmed_at = COALESCE(email_confirmed_at, now())
WHERE id = '6725d3bd-300d-451d-b742-75664c46b768';