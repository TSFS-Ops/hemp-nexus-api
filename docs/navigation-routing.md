# Navigation & Deep-Linking - Developer Notes

> Internal reference for anyone modifying routing, URL state, or auth flow.

---

## 1. Push vs Replace Rule

**All sub-state URL changes use `replace`. Only page-level navigation uses `push`.**

| Action | Method | Rationale |
|--------|--------|-----------|
| Tab change (`useUrlTab`) | `replace` | Back exits the page, not rewinding tabs |
| Filter / sort / search (`useUrlListParams`) | `replace` | Back exits the list, not rewinding filters |
| Pagination | `replace` | Judgement call - revisit if users complain |
| Sidebar / breadcrumb / bottom-nav links | `push` | Real navigation steps |
| Auth redirect (`RequireAuth` → `/auth?returnTo=`) | `replace` | Prevents protected URL leaking into history pre-auth |

**Consequence:** Browser back always reverses a *page-level* navigation step. It never cycles through tab or filter states within a page.

---

## 2. returnTo Validation (`src/lib/safe-redirect.ts`)

`getSafeReturnTo(raw, fallback = "/dashboard")` sanitises the `returnTo` query param before use. It blocks:

- Protocol-relative URLs (`//evil.com`)
- Backslash tricks (`/\evil.com`)
- Embedded protocols (`/javascript:...`)
- Encoded variants - iteratively decodes up to 5 rounds to catch double/triple encoding
- CRLF injection and null bytes

If validation fails, it returns `fallback`. Used in both `RequireAuth` and `Auth.tsx`.

**Do not bypass this function.** If you need a new redirect param, route it through `getSafeReturnTo`.

---

## 3. URL-Driven States

| State | Hook | URL Shape | File |
|-------|------|-----------|------|
| Settings tabs | `useUrlTab` | `?tab=keys\|webhooks\|billing\|purchase` | `DashboardSettings.tsx` |
| Match detail tabs | `useUrlTab` | `?tab=details\|documents\|terms\|notes\|evidence\|wad\|disputes\|timeline` | `MatchDetailsTabs.tsx` |
| Admin section tabs | `useUrlTab` | `?tab=pipeline\|users\|cases\|audit` (varies per section) | `Admin.tsx` |
| Matches list filters | `useUrlListParams` | `?status=matched&q=wheat&sort=commodity&page=2` | `MatchesList.tsx` |
| Counterparty search query | `useSearchParams` | `?q=rice+buyers` | `CounterpartySearch.tsx` |
| Auth return destination | query param | `?returnTo=/dashboard/matches/uuid` | `RequireAuth.tsx`, `Auth.tsx` |

**Hooks to use:**
- `useUrlTab(paramName, defaultValue, allowedValues)` - for Radix Tabs ↔ URL sync
- `useUrlListParams(defaults)` - for multi-param list views (search, filter, sort, page)

Both validate inputs: invalid tab values fall back to default; invalid sort values are rejected; page is clamped to `>= 0`.

---

## 4. Intentionally Local State (Not URL-Driven)

- **Search results** - derived from `?q=`, not stored in URL
- **Selected checkboxes** (matches, counterparties) - ephemeral selection, ugly as URL params
- **Dialogs / sheets / drawers** - settle confirm, demo confirm, similar counterparties, document sharing
- **Form drafts** - in-progress edits to settings, deal terms, notes
- **Pre-auth sessionStorage** (`src/lib/pre-auth-state.ts`) - stores selected counterparty IDs + pending action across auth. Complements (does not duplicate) URL-based `returnTo`

**Rule of thumb:** If it's meaningful to share or bookmark, put it in the URL. If it's ephemeral interaction state, keep it local.

---

## 5. 404 Behaviour by Context

| Context | Unknown Route | What Renders | File |
|---------|--------------|--------------|------|
| Top-level (`/xyz`) | Full-page 404 | "Page not found" with Dashboard + Home links | `NotFound.tsx` |
| Dashboard (`/dashboard/xyz`) | Inline 404 inside layout | "Page not found" with "Back to Overview" (sidebar stays visible) | `Dashboard.tsx` → `DashboardNotFound` |
| Admin (`/admin/xyz`) | Inline 404 inside layout | "Admin page not found" with "Back to Admin Overview" | `Admin.tsx` → `AdminNotFound` |
| Public domain + console route | Domain mismatch gate | "This content is on the console" with CTA | `DomainMismatch.tsx` |
| Console domain + public route | Domain mismatch gate | "This content is on the public site" with CTA | `DomainMismatch.tsx` |

**No silent redirects anywhere.** Every unknown path is visible.

---

## 6. Caveats for Future Developers

1. **Never edit `supabase/client.ts` or `types.ts`** - auto-generated.

2. **`useUrlTab` allowedValues must be kept in sync** with `<TabsTrigger value="...">`. If you add a tab, add it to the allowedValues array or the deep link will silently fall back to default.

3. **`useUrlListParams` defaults object must be stable** - if you pass a new object reference every render, it will cause infinite re-renders. Define defaults as a module-level `const`.

4. **`replace: true` is baked into both hooks.** If you ever need push semantics for a specific sub-state change, you'll need to fork the hook or add an option. Don't change the default - it will break back-button behaviour everywhere.

5. **Domain routing (`HostnameRouter.tsx`) runs before the React Router catch-all.** On production domains, a console-only route accessed from the public domain shows `DomainMismatch`, not `NotFound`. In preview mode (localhost / lovable.app), all routes are accessible.

6. **`CounterpartySearch` auto-searches on mount** if `?q=` is non-empty. The guard (`hasAutoSearched` + `initialQuery.trim()`) prevents duplicate calls, but if you restructure the component to re-mount (e.g., change the `key`), it will re-fire.

7. **Pre-auth state (`pre-auth-state.ts`) uses sessionStorage**, scoped to the tab. It persists selected counterparties and pending actions across the auth redirect. URL-based `returnTo` handles the *destination*; sessionStorage handles the *intent payload*. Both are needed.

---

## Key Files

| Purpose | File |
|---------|------|
| Route definitions + constants | `src/lib/constants.ts` |
| Top-level routing | `src/App.tsx` |
| Dashboard sub-routing | `src/pages/Dashboard.tsx` |
| Admin sub-routing | `src/pages/Admin.tsx` |
| Auth guard + returnTo | `src/components/RequireAuth.tsx` |
| returnTo validation | `src/lib/safe-redirect.ts` |
| Domain routing | `src/components/HostnameRouter.tsx` |
| Tab ↔ URL hook | `src/hooks/use-url-tab.ts` |
| List params ↔ URL hook | `src/hooks/use-url-search-params.ts` |
| Pre-auth state persistence | `src/lib/pre-auth-state.ts` |
| Mobile bottom nav | `src/components/MobileBottomNav.tsx` |
| Breadcrumbs | `src/components/ui/breadcrumbs.tsx` |
| 404 (top-level) | `src/pages/NotFound.tsx` |
