/**
 * Hostname detection utility for the Izenzo multi-domain architecture.
 *
 * Confirmed production architecture (client, 2026-05-04):
 *
 *   www.izenzo.co.za / izenzo.co.za   → Public Mother Ship website
 *                                       (landing, products, solutions, docs).
 *
 *   api.trade.izenzo.co.za            → Live authenticated console:
 *                                       dashboard, POI, WaD, billing, admin,
 *                                       compliance, trading desk, developer/
 *                                       API tools, execution workflows.
 *
 *   trade.izenzo.co.za                → RESERVED for future commodity
 *                                       marketplace verticals (cannabis,
 *                                       minerals, agriculture, carbon,
 *                                       energy). Shows a holding page; must
 *                                       NOT serve the live console.
 *
 *   api.izenzo.co.za                  → Not in use. Do not link to it.
 */
import { HOSTNAMES, ROUTES } from "@/lib/constants";

export type HostType = 'public' | 'console' | 'marketplace' | 'preview';

/**
 * Detect which face of the app should be shown based on hostname.
 *
 * Order matters: the most-specific subdomain wins.
 *   1. preview/localhost
 *   2. api.trade.izenzo.co.za  (console)
 *   3. trade.izenzo.co.za      (reserved marketplace)
 *   4. izenzo.co.za / www      (public)
 */
export function getHostType(): HostType {
  const hostname = window.location.hostname;

  // Preview / localhost — show all routes for development.
  if (
    hostname.includes('lovable.app') ||
    hostname.includes('localhost') ||
    hostname === '127.0.0.1'
  ) {
    return 'preview';
  }

  // Console first — it is the most specific subdomain and itself contains
  // "trade.izenzo.co.za", so it must be matched before the marketplace check.
  if (hostname === HOSTNAMES.CONSOLE || hostname.endsWith('.' + HOSTNAMES.CONSOLE)) {
    return 'console';
  }

  // Reserved marketplace host. Must be matched before the generic public
  // check, because trade.izenzo.co.za also ends with izenzo.co.za.
  if (hostname === HOSTNAMES.MARKETPLACE || hostname.endsWith('.' + HOSTNAMES.MARKETPLACE)) {
    return 'marketplace';
  }

  // Public Mother Ship site (www.izenzo.co.za or apex izenzo.co.za).
  if (hostname === HOSTNAMES.PUBLIC || hostname === HOSTNAMES.PUBLIC_WWW || hostname.endsWith('.' + HOSTNAMES.PUBLIC)) {
    return 'public';
  }

  // Default to preview for unknown environments.
  return 'preview';
}


/**
 * Check if current environment is preview/development.
 */
export function isPreview(): boolean {
  return getHostType() === 'preview';
}

/**
 * Get the console domain URL with optional path.
 * Always returns the live authenticated console at api.trade.izenzo.co.za.
 */
export function getConsoleUrl(path: string = ''): string {
  const hostType = getHostType();

  // In preview mode, use relative paths so deep links resolve in-app.
  if (hostType === 'preview') {
    return path;
  }

  return `https://${HOSTNAMES.CONSOLE}${path}`;
}

/**
 * Get the public Mother Ship URL with optional path.
 */
export function getPublicUrl(path: string = ''): string {
  const hostType = getHostType();

  if (hostType === 'preview') {
    return path;
  }

  return `https://${HOSTNAMES.PUBLIC_WWW}${path}`;
}

/**
 * Get the reserved marketplace URL with optional path.
 * Currently only serves a holding page.
 */
export function getMarketplaceUrl(path: string = ''): string {
  const hostType = getHostType();

  if (hostType === 'preview') {
    return path;
  }

  return `https://${HOSTNAMES.MARKETPLACE}${path}`;
}

/**
 * Routes that are only allowed on the public face (www.izenzo.co.za).
 */
export const PUBLIC_ONLY_ROUTES = [ROUTES.ROOT, ROUTES.DOCS];

/**
 * Routes that are only allowed on the console face (api.trade.izenzo.co.za).
 */
export const CONSOLE_ONLY_ROUTES = [
  ROUTES.DASHBOARD,
  ROUTES.ADMIN,
];


/**
 * Get redirect URL for disallowed routes.
 */
export function getRedirectForDisallowedRoute(pathname: string): string | null {
  const hostType = getHostType();

  if (hostType === 'preview') {
    return null;
  }

  if (hostType === 'public') {
    if (CONSOLE_ONLY_ROUTES.some(route => pathname.startsWith(route))) {
      return getConsoleUrl(pathname);
    }
  }

  return null;
}
