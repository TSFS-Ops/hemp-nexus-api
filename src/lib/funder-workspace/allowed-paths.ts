/**
 * Funder Persona Containment — allow-list of paths a funder-org user may
 * ever visit. Everything else redirects to `/funder/workspace`.
 *
 * Business rule (authoritative, client-directed):
 *   A user who belongs to a Funder Organisation belongs to exactly one
 *   workspace — the Funder Workspace. They must never see the workspace
 *   chooser and must never be able to reach Trade Desk, HQ, Compliance
 *   Console, Developer Centre, Platform Administration or any other
 *   Izenzo operating surface — even by typing the URL.
 *
 * Allowed prefixes:
 *   - `/funder/*`         — the funder workspace itself (all sub-routes)
 *   - `/auth`             — sign-in/sign-out flow
 *   - `/reset-password`   — password recovery flow
 *   - `/unsubscribe`      — email-list unsubscribe
 *   - `/trust`            — public trust/legal page
 *   - `/`                 — root only; RootElement will forward the funder
 *                           on to `/funder/workspace` (see FunderPersonaGuard)
 *
 * NOT allowed (redirected):
 *   - `/desk*`, `/hq*`, `/admin*`, `/governance*`, `/developers*`,
 *     `/compliance*`, `/registry*`, `/welcome`, `/billing`, `/settings`,
 *     `/dashboard*`, and every unknown/deep-linked URL.
 */

export const FUNDER_ALLOWED_EXACT: readonly string[] = [
  "/",
  "/auth",
  "/reset-password",
  "/trust",
] as const;

export const FUNDER_ALLOWED_PREFIXES: readonly string[] = [
  "/funder/",
  "/funder",
  "/unsubscribe",
  "/auth/", // /auth/callback etc.
] as const;

export const FUNDER_LANDING_PATH = "/funder/workspace" as const;

/**
 * Returns true when a funder-org user is allowed to remain on this path.
 * Query strings and hash fragments are ignored — only the pathname matters.
 */
export function isFunderAllowedPath(pathname: string): boolean {
  // Normalise: drop query/hash, trim trailing slash (except root)
  const raw = (pathname || "/").split("?")[0].split("#")[0];
  const path = raw.length > 1 && raw.endsWith("/") ? raw.slice(0, -1) : raw;

  if (FUNDER_ALLOWED_EXACT.includes(path)) return true;
  return FUNDER_ALLOWED_PREFIXES.some(
    (prefix) => path === prefix.replace(/\/$/, "") || path.startsWith(prefix),
  );
}
