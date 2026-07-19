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
 * Routes a funder-only user is permitted to visit while authenticated.
 * Everything else redirects to /funder/workspace.
 *
 * Rationale:
 *   - `/funder/*` is their canonical shell.
 *   - `/auth` and `/reset-password` support sign-in / re-auth.
 *   - `/unsubscribe` and `/status` are lightweight utility pages that
 *     do not expose authenticated application data.
 *   - `/` is the public marketing landing (no authenticated shell).
 *   - Product / solutions / legal marketing pages are static.
 *
 * Anything else — /desk, /dashboard, /admin, /hq, /registry,
 * /governance, /compliance, /marketplace, /discovery, /matches,
 * /support, /docs, /welcome, /developer(s), /trade, /billing — is a
 * platform shell that must not render for a funder-only user.
 */
export const FUNDER_ALLOWED_EXACT: readonly string[] = [
  "/",
  "/auth",
  "/reset-password",
  "/unsubscribe",
  "/status",
  "/trust",
  "/landing",
] as const;

export const FUNDER_ALLOWED_PREFIXES: readonly string[] = [
  "/funder/",
  "/auth/",
  "/products/",
  "/solutions/",
  "/pricing",
] as const;

/**
 * Authenticated application prefixes that a funder-only user must never
 * reach. Explicit list so we do not accidentally rely on marketing
 * pages to catch things.
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
    // Dual-role user — funder persona only if explicitly selected.
    return (signals.selectedPersona || "").toLowerCase() === "funder";
  }
  return true;
}

/**
 * Global containment decision. Returns `allow` when the route may
 * render, `loading` when signals are still resolving (render neutral
 * skeleton — never the destination shell), and `redirect` otherwise.
 */
export function resolveFunderContainment(
  pathname: string,
  signals: ContainmentSignals,
): ContainmentDecision {
  // Unauthenticated users: defer to RequireAuth / public routing.
  if (!signals.isAuthenticated) return { kind: "allow" };
  // Platform admins are never contained.
  if (signals.isPlatformAdmin) return { kind: "allow" };

  // Non-funder users pass through untouched (trade-only, admin-only, etc.).
  if (!signals.isFunderUser) return { kind: "allow" };

  // For any user who *might* be contained, wait for signals before
  // deciding — do NOT flash a denied shell.
  if (signals.loading) return { kind: "loading" };

  if (!isFunderOnly(signals)) return { kind: "allow" };

  // Funder-only user. Whitelist first, then denylist.
  if (FUNDER_ALLOWED_EXACT.includes(pathname as (typeof FUNDER_ALLOWED_EXACT)[number])) {
    return { kind: "allow" };
  }
  if (pathMatchesPrefix(pathname, FUNDER_ALLOWED_PREFIXES)) {
    return { kind: "allow" };
  }
  if (pathMatchesPrefix(pathname, FUNDER_DENY_PREFIXES)) {
    return { kind: "redirect", to: "/funder/workspace" };
  }

  // Any other unknown authenticated application path also redirects.
  // Unknown static/marketing paths (e.g. /trust variants) are covered
  // by FUNDER_ALLOWED_EXACT / marketing prefixes above.
  return { kind: "allow" };
}
