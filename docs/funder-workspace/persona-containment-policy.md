# Funder Persona Containment Policy

**Status:** Enforced (UI layer). Backend RLS/RPC/edge-function enforcement is
tracked separately — see "Known limits" below.

**Owner:** Funder Workspace

**Applies to:** Any authenticated user whose active membership is *funder-only*
(has an active row in `p5_batch3_funder_users`, no trade-persona role on
`user_roles`, no trade `org_id` on `profiles`, and — if a persona is pinned —
`selected_persona = 'funder'`).

---

## 1. Client policy (verbatim)

> Funders belong entirely inside a dedicated, assigned-only Funder Workspace
> and must not see or access the wider Trade Desk or other Izenzo applications.

## 2. Rule: default-DENY

For an authenticated funder-only user, **every route is denied** unless it
appears on the allow-list below. This includes:

- The root marketing page (`/`) — advertises Trade Desk features.
- Legal / terms / privacy pages.
- Unknown or mistyped paths.
- Any deep link into `/desk`, `/dashboard`, `/admin`, `/hq`, `/registry`,
  `/governance`, `/compliance`, `/marketplace`, `/discovery`, `/matches`,
  `/developer[s]`, `/docs`, `/support`, `/billing`, `/welcome`, `/trade`.

Denied navigations redirect to **`/funder/workspace`** with `replace: true`
(no back-button escape hatch).

## 3. Allow-list (exhaustive)

| Path pattern           | Why permitted                                              |
| ---------------------- | ---------------------------------------------------------- |
| `/funder/**`           | Canonical Funder Workspace shell.                          |
| `/auth`, `/auth/**`    | Sign-in, callback, re-auth, password flows.                |
| `/reset-password`      | Password reset landing.                                    |
| `/unsubscribe`         | Email preference utility (no app data).                    |
| `/status`              | Public status page (no app data).                          |

Anything not matching the above → `Navigate to="/funder/workspace" replace`.

**Platform admins are never contained.** `platform_admin` short-circuits the
rule to `allow`.

## 4. Loading semantics (no protected-shell flash)

While auth session, roles, or the funder-membership probe are still resolving,
the containment component renders a neutral placeholder
(`data-testid="funder-persona-containment-loading"`), **never the destination
shell**. This eliminates the brief render of Trade Desk chrome that would
otherwise happen on hard refresh of a deep link.

## 5. Enforcement in code

Three files form the enforcement:

| File                                                        | Role                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/lib/funder-workspace/persona-containment.ts`           | Pure decision function `resolveFunderContainment(pathname, signals)`. Single source of truth for the rule. |
| `src/components/FunderPersonaContainment.tsx`               | Runtime shell. Wraps the entire routed tree in `App.tsx`. Resolves signals and applies the decision on every navigation, including hard refresh and browser-back. |
| `src/hooks/use-funder-membership.ts`                        | Read-only `isFunderUser` probe via the `fw_current_funder_org_v1` SECURITY DEFINER RPC. Used by shared chrome (e.g. `PublicHeader`) to steer funder users to `/funder/workspace`. |

Signals fed into the decision:

- `isAuthenticated`, `isPlatformAdmin`, `roles`, `rolesLoaded`, `isLoading`
  from `useAuth()`.
- `isFunderUser` from `rpc('fw_current_funder_org_v1')` (SECURITY DEFINER —
  bypasses the missing table GRANT on `p5_batch3_funder_users`).
- `hasTradeMembership` derived from trade-persona roles in
  `TRADE_PERSONA_ROLES`.
- `selectedPersona` from `profiles.selected_persona`.

Decision matrix (from `resolveFunderContainment`):

```
!isAuthenticated                        → allow  (RequireAuth handles gating)
isPlatformAdmin                         → allow
!isFunderUser                           → allow
signals still loading                   → loading (neutral placeholder)
isFunderUser && !isFunderOnly           → allow  (dual trade+funder membership)
isFunderUser && isFunderOnly && allowed → allow
isFunderUser && isFunderOnly && !allowed→ redirect /funder/workspace
```

`isFunderOnly` returns true when the user has funder membership AND either has
no trade membership OR has pinned `selected_persona = 'funder'`.

## 6. Enforcement in tests

| Suite                                                          | Guarantees                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/tests/funder-persona-containment.test.ts` (Vitest)        | Unit tests over `resolveFunderContainment`. Enumerates every denylisted prefix, every allow-list entry, marketing `/`, unknown paths, loading state, and admin short-circuit. Guards the decision rule against regression. |
| `e2e/journeys/funder-persona-containment.spec.ts` (Playwright) | Signs in as `FUNDER_ONLY_EMAIL` and asserts every disallowed route (marketing, Trade Desk, admin, HQ, governance, compliance, registry, marketplace, discovery, developer, docs, support, billing, unknown/nested) lands on `/funder/workspace`. Includes hard-refresh persistence and a no-flash guard on `commit`. |

CI wires both. The Vitest suite runs on every PR; the Playwright suite runs
when `FUNDER_ONLY_EMAIL` / `FUNDER_ONLY_PASSWORD` are provisioned.

## 7. Adding a new allowed path

1. Add the exact path to `FUNDER_ALLOWED_EXACT` **or** the prefix to
   `FUNDER_ALLOWED_PREFIXES` in `src/lib/funder-workspace/persona-containment.ts`.
2. Add a matching case to `src/tests/funder-persona-containment.test.ts`.
3. Add it to `ALLOWED_ROUTES` in the Playwright spec.
4. Update the allow-list table in §3 of this document.

Do **not** remove a path from `FUNDER_DENY_PREFIXES` to permit access — the
denylist is documentary. The effective policy is default-DENY; only entries in
the allow-list are permitted.

## 8. Known limits (backend gap)

This policy is enforced in the **React/UI layer only**. A funder-only user
holding a valid session can still hit protected data by calling `supabase-js`
directly (bypassing the SPA). Complete enforcement requires:

1. `public.is_funder_only(uid uuid)` SECURITY DEFINER helper.
2. `AND NOT public.is_funder_only(auth.uid())` predicate added to RLS on every
   Trade Desk / admin / registry / governance / compliance table.
3. Guard at the top of every SECURITY DEFINER RPC callable by `authenticated`.
4. `403 funder_only_forbidden` check in every non-funder edge function after
   `getClaims()`.

Tracked as a backend follow-up; not in scope for the UI layer.

## 9. Non-goals

- This policy does not govern **unauthenticated** visitors — they hit the
  public marketing site normally. `RequireAuth` handles auth gating.
- This policy does not affect **platform admins** — they retain full access.
- This policy does not enforce data isolation *within* the Funder Workspace —
  that is RLS on `p5_batch3_*` tables.
