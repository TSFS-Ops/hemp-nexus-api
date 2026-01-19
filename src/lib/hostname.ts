/**
 * Hostname detection utility for dual-face application routing
 * 
 * Public Face (www.izenzo.co.za): Landing, Demo, Docs
 * Developer Console (api.trade.izenzo.co.za): Dashboard, API Keys, Logs, Admin
 */

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
  if (hostname.includes('api.trade.izenzo.co.za')) {
    return 'console';
  }
  
  // Public domain (www.izenzo.co.za or izenzo.co.za)
  if (hostname.includes('izenzo.co.za')) {
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
  
  return `https://api.trade.izenzo.co.za${path}`;
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
  
  return `https://www.izenzo.co.za${path}`;
}

/**
 * Routes that are only allowed on the public face
 */
export const PUBLIC_ONLY_ROUTES = ['/', '/demo', '/docs'];

/**
 * Routes that are only allowed on the console face
 */
export const CONSOLE_ONLY_ROUTES = [
  '/dashboard',
  '/admin',
  '/activity',
  '/analytics',
  '/marketplace'
];

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
    // Allow public routes and auth
    return (
      pathname === '/' ||
      pathname === '/demo' ||
      pathname === '/docs' ||
      pathname === '/auth'
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
