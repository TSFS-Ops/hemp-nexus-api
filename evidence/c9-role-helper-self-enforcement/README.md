# C9 — has_role self-enforcement repair

Status: `C9_ROLE_HELPER_SELF_ENFORCEMENT_DEPLOYED_PENDING_VERIFICATION`

## Risk closed
`public.has_role(_user_id uuid, _role app_role)` was `EXECUTE`-granted to
`authenticated` and accepted an arbitrary `_user_id`, allowing any signed-in
user to enumerate role assignments for any other user via PostgREST RPC.

## Why we did not revoke EXECUTE
274 RLS policies in `public` call `has_role(auth.uid(), ...)`. RLS predicates
are evaluated in the querying role's context, so revoking `EXECUTE` from
`authenticated` would break those policies platform-wide. All 274 references
already pass `auth.uid()`; 0 pass a non-self id.

## Chosen repair
Function-body-only change. Signature, grants, language, volatility, security
definer flag, and `search_path` preserved.

```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND (
        auth.uid() IS NULL
        OR _user_id = auth.uid()
      )
  )
$function$;
```

## Service-role preservation
Service-role / cron / edge-function callers run without a JWT, so
`auth.uid()` returns NULL and the predicate degrades to the original
behaviour. Authenticated RPC callers always have a non-null `auth.uid()`,
so they can only check their own id.

## Frontend call sites (already self-only)
- `src/components/MaintenanceBanner.tsx` — passes `user.id`
- `src/components/facilitation-outreach/useOutreachRoles.ts` — passes `user.id`

## Guarantees / non-changes
- No `REVOKE`
- No `GRANT`
- No RLS policy created, dropped, or altered
- No table grant changed
- `has_dd_role` untouched
- No edge functions deployed
- No business/runtime data mutated
- No emails / providers called

## Migration
`supabase/migrations/20260630175934_98858f64-342e-48c8-81de-b291316ae215.sql`

## Guard test
`src/tests/c9-role-helper-self-enforcement.test.ts`
