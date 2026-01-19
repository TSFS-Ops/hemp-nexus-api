import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { getHostType, getRedirectForDisallowedRoute, getConsoleUrl } from "@/lib/hostname";

interface HostnameRouterProps {
  children: React.ReactNode;
}

/**
 * HostnameRouter wraps the app and handles:
 * - Route restrictions based on hostname
 * - Automatic redirects for unauthorized routes
 * - Cross-domain navigation
 */
export function HostnameRouter({ children }: HostnameRouterProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const hostType = getHostType();

  useEffect(() => {
    const pathname = location.pathname;
    
    // Check if route is disallowed on this host
    const redirectUrl = getRedirectForDisallowedRoute(pathname);
    
    if (redirectUrl) {
      // External redirect to console domain
      window.location.href = redirectUrl;
      return;
    }
    
    // Console domain: redirect "/" to "/dashboard" 
    if (hostType === 'console' && pathname === '/') {
      navigate('/dashboard', { replace: true });
      return;
    }
  }, [location.pathname, hostType, navigate]);

  return <>{children}</>;
}

/**
 * Hook to get cross-domain URLs
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
