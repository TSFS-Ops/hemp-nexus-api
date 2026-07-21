/**
 * Global Funder-Persona Containment (pure decision layer).
 *
 * A user whose active access is funder-only must remain inside the
 * canonical Funder Workspace (/funder/*). This module is the single
 * source of truth for that rule — every route decision, test and audit
 * runs through `resolveFunderContainment`.
 *
 * This is a UI containment layer. RLS on funder / trade tables remains
 * the security authority; this only chooses whether the persona shell
 * is allowed to render.
 *
 * NEVER uses email-address logic. All inputs are server-backed signals.
 */

export type ContainmentDecision =
  | { kind: "allow" }
  | { kind: "loading" }
  | { kind: "redirect"; to: string };

export interface ContainmentSignals {
  /** Auth session is still restoring / roles/profile not yet loaded. */
  loading: boolean;
  /** True when the user is authenticated. Unauthenticated → allow (RequireAuth handles gating). */
  isAuthenticated: boolean;
  /** platform_admin role — never contained. */
  isPlatformAdmin: boolean;
  /** Active row in p5_batch3_funder_users (any funder role, non-terminal status). */
  isFunderUser: boolean;
  /**
   * Genuine trade-side membership: trade org_id on profiles OR one of the
   * trade-persona roles on user_roles. Funder rows do NOT count.
   */
  hasTradeMembership: boolean;
  /** profiles.selected_persona — "funder" | "trade" | "developer" | "governance" | null. */
  selectedPersona: string | null;
}

/**
 * Routes an authenticated funder-only user is permitted to visit.
 *
 * Client policy is strict: funders belong entirely inside the dedicated
 * Funder Workspace and must not see or access the wider Trade Desk or
 * any other Izenzo application shell (including the public marketing
 * surface, which advertises Trade Desk features and CTAs). We therefore
 * operate on a default-DENY basis for any authenticated funder-only
 * user — only the narrow set below is permitted, everything else
 * redirects to /funder/workspace.
 *
 * Permitted:
 *   - /funder/*        — canonical Funder Workspace shell.
 *   - /auth, /auth/*   — sign-in / callback / re-auth.
 *   - /reset-password  — password reset flow.
 *   - /unsubscribe     — email preference utility (no app data).
 *   - /status          — public status page (no app data).
 */
export const FUNDER_ALLOWED_EXACT: readonly string[] = [
  "/auth",
  "/reset-password",
  "/unsubscribe",
  "/status",
] as const;

export const FUNDER_ALLOWED_PREFIXES: readonly string[] = [
  "/funder/",
  "/auth/",
] as const;

/**
 * Explicit denylist retained for documentation / test invariants.
 * The effective policy is default-deny, so this list is not consulted
 * to make the decision — it is kept so contract tests can assert that
 * every high-risk platform shell is unreachable.
 */
export const FUNDER_DENY_PREFIXES: readonly string[] = [
  "/desk",
  "/dashboard",
  "/admin",
  "/hq",
  "/registry",
  "/governance",
  "/compliance",
  "/marketplace",
  "/discovery",
  "/matches",
  "/support",
  "/docs",
  "/welcome",
  "/developer",
  "/developers",
  "/trade",
  "/billing",
] as const;

function pathMatchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) =>
    p.endsWith("/") ? pathname === p.slice(0, -1) || pathname.startsWith(p) : pathname === p || pathname.startsWith(p + "/"),
  );
}

/**
 * Is this user funder-only? True when they hold a funder membership,
 * have no trade membership, and (if a persona is selected) have not
 * pinned a non-funder persona.
 */
export function isFunderOnly(signals: ContainmentSignals): boolean {
  if (!signals.isFunderUser) return false;
  if (signals.hasTradeMembership) {
    return (signals.selectedPersona || "").toLowerCase() === "funder";
  }
  return true;
}

/**
 * Global containment decision. Returns `allow` when the route may
 * render, `loading` when signals are still resolving (render neutral
 * skeleton — never the destination shell), and `redirect` otherwise.
 *
 * Policy for authenticated funder-only users is default-DENY.
 */
export function resolveFunderContainment(
  pathname: string,
  signals: ContainmentSignals,
): ContainmentDecision {
  if (!signals.isAuthenticated) return { kind: "allow" };
  if (signals.isPlatformAdmin) return { kind: "allow" };
  if (!signals.isFunderUser) return { kind: "allow" };
  if (signals.loading) return { kind: "loading" };
  if (!isFunderOnly(signals)) return { kind: "allow" };

  if (FUNDER_ALLOWED_EXACT.includes(pathname as (typeof FUNDER_ALLOWED_EXACT)[number])) {
    return { kind: "allow" };
  }
  if (pathMatchesPrefix(pathname, FUNDER_ALLOWED_PREFIXES)) {
    return { kind: "allow" };
  }
  return { kind: "redirect", to: "/funder/workspace" };
}
