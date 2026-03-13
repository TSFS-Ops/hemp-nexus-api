/**
 * RequireAuth — Single source of truth for authenticated route guards.
 *
 * Redirects unauthenticated users to /auth?returnTo=<current-path>
 * instead of rendering sign-in UI at the protected URL.
 *
 * Usage:
 *   <RequireAuth>
 *     <ProtectedPageContent />
 *   </RequireAuth>
 *
 *   <RequireAuth role="platform_admin" fallbackRoute="/dashboard">
 *     <AdminContent />
 *   </RequireAuth>
 */

import { ReactNode, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { ROUTES } from "@/lib/constants";
import { getSafeReturnTo } from "@/lib/safe-redirect";
import { useNavigate, useLocation } from "react-router-dom";
import type { AppRole } from "@/lib/constants";

interface RequireAuthProps {
  children: ReactNode;
  /** Optional role required beyond basic authentication */
  role?: AppRole | AppRole[];
  /** Where to send the user if they lack the required role (default: /dashboard) */
  fallbackRoute?: string;
  /** Custom loading element (defaults to FullPageLoader) */
  loader?: ReactNode;
}

export function RequireAuth({ children, role, fallbackRoute, loader }: RequireAuthProps) {
  const { isLoading, isAuthenticated, roles } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect unauthenticated users to /auth with returnTo
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      const currentPath = location.pathname + location.search + location.hash;
      const returnTo = encodeURIComponent(currentPath);
      navigate(`${ROUTES.AUTH}?returnTo=${returnTo}`, { replace: true });
    }
  }, [isLoading, isAuthenticated, navigate, location]);

  if (isLoading) {
    return <>{loader ?? <FullPageLoader />}</>;
  }

  if (!isAuthenticated) {
    // Render nothing while redirect effect fires
    return <>{loader ?? <FullPageLoader />}</>;
  }

  // Role check
  if (role) {
    const requiredRoles = Array.isArray(role) ? role : [role];
    const hasRequiredRole = requiredRoles.some(r => roles.includes(r));

    if (!hasRequiredRole) {
      // Use effect for role-based redirect to avoid render-during-render
      return <RoleRedirect fallbackRoute={fallbackRoute ?? ROUTES.DASHBOARD} />;
    }
  }

  return <>{children}</>;
}

/** Small helper component to redirect on missing role without calling navigate during render */
function RoleRedirect({ fallbackRoute }: { fallbackRoute: string }) {
  const navigate = useNavigate();
  const { isPlatformAdmin } = useAuth();

  useEffect(() => {
    if (!isPlatformAdmin) {
      toast.error("You don't have permission to access this page. Contact your organisation admin if you believe this is an error.");
    }
    navigate(fallbackRoute, { replace: true });
  }, [navigate, fallbackRoute, isPlatformAdmin]);

  return <FullPageLoader />;
}

