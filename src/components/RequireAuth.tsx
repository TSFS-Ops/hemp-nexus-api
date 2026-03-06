/**
 * RequireAuth — Single source of truth for authenticated route guards.
 *
 * Replaces the 7+ scattered patterns of:
 *   if (loading) return <Loader2 spinner />
 *   if (!session) return <div>Please sign in <Button>Sign In</Button></div>
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

import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { FullPageLoader } from "@/components/ui/full-page-loader";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/constants";
import { useNavigate } from "react-router-dom";
import type { AppRole } from "@/lib/constants";

interface RequireAuthProps {
  children: ReactNode;
  /** Optional role required beyond basic authentication */
  role?: AppRole | AppRole[];
  /** Where to send the user if they lack the required role (default: show sign-in) */
  fallbackRoute?: string;
  /** Custom loading element (defaults to FullPageLoader) */
  loader?: ReactNode;
}

export function RequireAuth({ children, role, fallbackRoute, loader }: RequireAuthProps) {
  const { isLoading, isAuthenticated, roles } = useAuth();
  const navigate = useNavigate();

  if (isLoading) {
    return <>{loader ?? <FullPageLoader />}</>;
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-muted-foreground">Please sign in to continue.</p>
        <Button
          onClick={() => navigate(ROUTES.AUTH)}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          Sign In
        </Button>
      </div>
    );
  }

  // Role check
  if (role) {
    const requiredRoles = Array.isArray(role) ? role : [role];
    const hasRequiredRole = requiredRoles.some(r => roles.includes(r));

    if (!hasRequiredRole) {
      if (fallbackRoute) {
        navigate(fallbackRoute, { replace: true });
        return null;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <p className="text-muted-foreground">You do not have permission to access this page.</p>
          <Button
            variant="outline"
            onClick={() => navigate(ROUTES.DASHBOARD)}
          >
            Go to Dashboard
          </Button>
        </div>
      );
    }
  }

  return <>{children}</>;
}
