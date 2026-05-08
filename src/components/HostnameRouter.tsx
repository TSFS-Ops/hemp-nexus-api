import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getHostType, getConsoleUrl, PUBLIC_ONLY_ROUTES } from "@/lib/hostname";
import { DomainMismatch } from "@/components/DomainMismatch";
import { HOSTNAMES } from "@/lib/constants";
import { useAuth } from "@/contexts/AuthContext";
import Landing from "@/pages/Landing";

/**
 * Hard-redirect (full page navigation) the current browser to the live
 * console host, preserving path, query, and hash. Used when traffic lands
 * on the public Mother Ship (izenzo.co.za / www.izenzo.co.za) or on the
 * reserved marketplace host (trade.izenzo.co.za) — per client direction
 * (David Davies, 2026-05-08), neither of those domains should serve a
 * holding page; both must funnel visitors to api.trade.izenzo.co.za so the
 * SEO presence and inbound traffic routes into the live product.
 *
 * `window.location.replace` is used (not `assign`) so the holding-page URL
 * does not pollute browser history and the back button behaves naturally.
 */
function redirectToConsole(): null {
  if (typeof window === "undefined") return null;
  const { pathname, search, hash } = window.location;
  const target = `https://${HOSTNAMES.CONSOLE}${pathname}${search}${hash}`;
  // Guard against a redirect loop in the (impossible-by-config but
  // defensible) case where this ever runs on the console host itself.
  if (window.location.host !== HOSTNAMES.CONSOLE) {
    window.location.replace(target);
  }
  return null;
}

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
  const { user, isLoading: authLoading } = useAuth();

  // Console domain only: if a signed-in user lands on "/", send them to the
  // dashboard. Unauthenticated visitors at "/" see the public Landing page
  // (the former izenzo.co.za home), handled below — no redirect.
  useEffect(() => {
    if (hostType === 'console' && pathname === '/' && !authLoading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [pathname, hostType, navigate, user, authLoading]);

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

  // CONSOLE DOMAIN
  if (hostType === 'console') {
    // Root: show the public Landing page to guests; signed-in users are
    // redirected to /dashboard by the effect above.
    if (pathname === '/' && !authLoading && !user) {
      return <Landing />;
    }

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
