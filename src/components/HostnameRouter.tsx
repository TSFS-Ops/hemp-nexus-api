import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getHostType, getConsoleUrl, PUBLIC_ONLY_ROUTES } from "@/lib/hostname";
import { DomainMismatch } from "@/components/DomainMismatch";
import MarketplaceHolding from "@/pages/MarketplaceHolding";
import PublicHolding from "@/pages/PublicHolding";

interface HostnameRouterProps {
  children: React.ReactNode;
}

/**
 * Checks if a pathname matches any route in the provided list.
 * Handles both exact matches and prefix matches for nested routes.
 */
function matchesRouteList(pathname: string, routes: string[]): boolean {
  return routes.some(route => {
    // Exact match
    if (pathname === route) return true;
    // Prefix match for nested routes (e.g., /dashboard/matches/123)
    if (pathname.startsWith(route + '/')) return true;
    return false;
  });
}

/**
 * HostnameRouter wraps the app and handles:
 * - Soft-gate rendering when accessing wrong "door" content
 * - Internal navigation for console root → dashboard
 * 
 * CRITICAL: This component NEVER performs cross-domain redirects automatically.
 * Users must explicitly click CTAs to navigate between domains.
 */
export function HostnameRouter({ children }: HostnameRouterProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const hostType = getHostType();
  const pathname = location.pathname;

  // Console domain only: internal redirect "/" to "/dashboard"
  // This is a same-domain SPA navigation, NOT a cross-domain redirect
  useEffect(() => {
    if (hostType === 'console' && pathname === '/') {
      navigate('/dashboard', { replace: true });
    }
  }, [pathname, hostType, navigate]);

  // Preview mode: allow everything (for development/testing)
  if (hostType === 'preview') {
    return <>{children}</>;
  }

  // Reserved marketplace host (trade.izenzo.co.za) — never serve the live
  // console here. Show a holding page that soft-gates visitors to the
  // authenticated console at api.trade.izenzo.co.za.
  if (hostType === 'marketplace') {
    return <MarketplaceHolding />;
  }

  // PUBLIC DOMAIN (izenzo.co.za / www.izenzo.co.za): show neutral
  // under-construction holding page only. The public Mother Ship website is
  // not yet live; no app routes are exposed here.
  if (hostType === 'public') {
    return <PublicHolding />;
  }

  // CONSOLE DOMAIN: Check if user is trying to access public-only content
  if (hostType === 'console') {
    // Check if this is a public-only route (excluding root which we handle above)
    const isPublicRoute = matchesRouteList(pathname, PUBLIC_ONLY_ROUTES) && pathname !== '/';
    
    if (isPublicRoute) {
      // Show soft-gate with CTA - NO automatic redirect
      return <DomainMismatch type="public-content-on-console" attemptedPath={pathname} />;
    }
  }

  // Route is allowed on this domain - render normally
  return <>{children}</>;
}

/**
 * Hook to get cross-domain URLs for CTAs
 * Use this to build "Sign In", "Get API Key", etc. links
 */
export function useCrossDomainUrls() {
  const hostType = getHostType();
  
  return {
    hostType,
    getAuthUrl: () => getConsoleUrl('/auth'),
    getDashboardUrl: () => getConsoleUrl('/dashboard'),
    isPublic: hostType === 'public',
    isConsole: hostType === 'console',
    isPreview: hostType === 'preview',
  };
}
