/**
 * Hostname detection utility for dual-face application routing
 * 
 * Public Face (www.izenzo.co.za): Landing, Demo, Docs
 * Developer Console (api.trade.izenzo.co.za): Dashboard, API Keys, Logs, Admin
 */
import { HOSTNAMES, ROUTES } from "@/lib/constants";

export type HostType = 'public' | 'console' | 'preview';

/**
 * Detect which face of the app should be shown based on hostname
 */
export function getHostType(): HostType {
  const hostname = window.location.hostname;
  
  // Preview/localhost environments - show all routes for testing
  if (
    hostname.includes('lovable.app') || 
    hostname.includes('localhost') || 
    hostname === '127.0.0.1'
  ) {
    return 'preview';
  }
  
  // Console domain (api.trade.izenzo.co.za)
  if (hostname.includes(HOSTNAMES.CONSOLE)) {
    return 'console';
  }
  
  // Public domain (www.izenzo.co.za or izenzo.co.za)
  if (hostname.includes(HOSTNAMES.PUBLIC)) {
    return 'public';
  }
  
  // Default to preview for unknown environments
  return 'preview';
}

/**
 * Check if current environment is the public face
 */
export function isPublicFace(): boolean {
  return getHostType() === 'public';
}

/**
 * Check if current environment is the developer console
 */
export function isConsoleFace(): boolean {
  return getHostType() === 'console';
}

/**
 * Check if current environment is preview/development
 */
export function isPreview(): boolean {
  return getHostType() === 'preview';
}

/**
 * Get the console domain URL with optional path
 */
export function getConsoleUrl(path: string = ''): string {
  const hostType = getHostType();
  
  // In preview mode, use relative paths
  if (hostType === 'preview') {
    return path;
  }
  
  return `https://${HOSTNAMES.CONSOLE}${path}`;
}

/**
 * Get the public domain URL with optional path
 */
export function getPublicUrl(path: string = ''): string {
  const hostType = getHostType();
  
  // In preview mode, use relative paths
  if (hostType === 'preview') {
    return path;
  }
  
  return `https://${HOSTNAMES.PUBLIC_WWW}${path}`;
}

/**
 * Routes that are only allowed on the public face (www.izenzo.co.za)
 * These show the product demo, search, and proof-of-intent
 */
export const PUBLIC_ONLY_ROUTES = [ROUTES.ROOT, ROUTES.LANDING, ROUTES.DEMO, ROUTES.DOCS];

/**
 * Routes that are only allowed on the console face (api.trade.izenzo.co.za)
 * These show API keys, logs, evidence packs, admin features
 */
export const CONSOLE_ONLY_ROUTES = [
  ROUTES.DASHBOARD,
  ROUTES.ADMIN,
  ROUTES.ACTIVITY,
  ROUTES.ANALYTICS,
  ROUTES.MARKETPLACE,
  ROUTES.INVITES,
  ROUTES.BILLING,
];

/**
 * Shared routes allowed on both domains
 */
export const SHARED_ROUTES = [ROUTES.AUTH, ROUTES.PRICING];

/**
 * Check if a route is allowed on the current host
 */
export function isRouteAllowed(pathname: string): boolean {
  const hostType = getHostType();
  
  // Preview allows all routes
  if (hostType === 'preview') {
    return true;
  }
  
  // Public face restrictions
  if (hostType === 'public') {
    // Allow public routes, auth, and shared routes like pricing
    return (
      pathname === ROUTES.ROOT ||
      pathname === ROUTES.DEMO ||
      pathname === ROUTES.DOCS ||
      pathname === ROUTES.PRICING ||
      pathname === ROUTES.AUTH
    );
  }
  
  // Console face - allow everything except explicit public-only if needed
  return true;
}

/**
 * Get redirect URL for disallowed routes
 */
export function getRedirectForDisallowedRoute(pathname: string): string | null {
  const hostType = getHostType();
  
  // Preview allows all
  if (hostType === 'preview') {
    return null;
  }
  
  // Public face trying to access console routes
  if (hostType === 'public') {
    if (CONSOLE_ONLY_ROUTES.some(route => pathname.startsWith(route))) {
      return getConsoleUrl(pathname);
    }
  }
  
  return null;
}
