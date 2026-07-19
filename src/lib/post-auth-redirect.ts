/**
 * Post-sign-in destination policy.
 *
 * Client direction (David Davies, 2026-06-25): after a normal sign-in from the
 * public website, the user must land on the home page (`/`), NOT the trading
 * desk. We only honour `returnTo` when it points at an explicitly protected /
 * workspace route AND was set as part of a deliberate protected-route auth
 * flow. Generic browser history, stale session memory, external URLs, and
 * malformed values must all be rejected.
 */

import { getSafeReturnTo } from "@/lib/safe-redirect";

/**
 * Internal route prefixes that represent a deliberate workspace / protected
 * journey. A `returnTo` value is only honoured when it begins with one of
 * these prefixes (after `getSafeReturnTo` sanitisation). Everything else —
 * including bare `/`, `/dashboard` (legacy), `/auth`, and arbitrary public
 * pages — is treated as a stale/inadvertent redirect and dropped.
 */
export const PROTECTED_RETURN_PREFIXES: readonly string[] = [
  "/desk",
  "/hq",
  "/admin",
  "/funder",
  "/governance",
  "/developers",
  "/registry/my",
  "/welcome",
  "/billing",
  "/settings",
  "/compliance",
] as const;

export type Persona = "developer" | "governance" | "trade" | null | undefined;

export interface PostAuthInputs {
  /** True if the user has the platform_admin role. */
  isPlatformAdmin: boolean;
  /**
   * True if the user has an active row in `p5_batch3_funder_users`
   * (any funder role: funder_org_admin, funder_approver, funder_reviewer,
   * funder_viewer, external_adviser). When true, the workspace treats them
   * as an Institutional Funder Evidence Workspace user for landing-route
   * purposes. A redirect is not a security control — RLS on
   * funder_deal_releases / p5_batch3_* still governs data access.
   */
  isFunderUser?: boolean;
  /** Persisted persona selection, if any. */
  persona: Persona;
  /** Raw `returnTo` query-string value (untrusted). */
  rawReturnTo: string | null | undefined;
  /**
   * True when the returnTo value was set as part of an intentional protected
   * journey (e.g. RequireAuth redirected the user here, an expired session
   * was being recovered, or a deep link triggered the sign-in). When false,
   * we treat any returnTo as stale/inadvertent and ignore it.
   */
  returnToIsIntentional: boolean;
  /**
   * True when a pre-auth journey was captured (e.g. a search query entered
   * by an anonymous user). Used to resume into /desk only when a trade
   * persona is already selected.
   */
  hasPreAuthJourney: boolean;
}

/**
 * Resolve `returnTo` against the strict allow-list. Returns `null` when the
 * value should be dropped (external, malformed, stale, or non-protected).
 */
export function resolveProtectedReturnTo(
  rawReturnTo: string | null | undefined,
  returnToIsIntentional: boolean,
): string | null {
  if (!rawReturnTo) return null;
  if (!returnToIsIntentional) return null;

  // getSafeReturnTo with empty fallback returns "" for invalid input —
  // external URLs, protocol-relative, encoded protocols, backslashes, etc.
  const safe = getSafeReturnTo(rawReturnTo, "");
  if (!safe) return null;
  if (safe === "/" || safe === "/dashboard" || safe.startsWith("/auth")) return null;

  const path = safe.split("?")[0].split("#")[0];
  const allowed = PROTECTED_RETURN_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix + "/"),
  );
  return allowed ? safe : null;
}

/**
 * Pure resolver for the post-sign-in destination. UI calls this with the
 * inputs it has already gathered (role, persona, query-string returnTo, and
 * whether that returnTo is part of an intentional protected journey).
 */
export function resolvePostAuthDestination(input: PostAuthInputs): string {
  // 1) Intentional, allow-listed protected deep links win for ALL roles —
  //    including platform admins. This preserves the "deep-link → sign in →
  //    resume" flow (e.g. opening /hq/users or /desk/match/x directly).
  const honoured = resolveProtectedReturnTo(input.rawReturnTo, input.returnToIsIntentional);
  if (honoured) {
    return `${honoured}${honoured.includes("?") ? "&" : "?"}resume=1`;
  }

  // 2) Platform admin default — per client direction (David Davies,
  //    2026-06-25): a normal sign-in from the public homepage must NOT dump
  //    admins straight into HQ. They land on `/` in a logged-in state and
  //    use the homepage "Go to HQ" CTA to enter the workspace.
  if (input.isPlatformAdmin) return "/";

  // 3) Persona-based defaults for non-admins.
  if (!input.persona) return "/welcome";
  if (input.persona === "developer") return "/developers/keys";
  if (input.persona === "governance") return "/governance/triage";

  // 4) Trade persona — default to the public home page unless an explicit
  //    pre-auth journey (e.g. search query) is queued for resume.
  if (input.hasPreAuthJourney) return "/desk?resume=1";
  return "/";
}
