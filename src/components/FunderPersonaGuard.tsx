/**
 * FunderPersonaGuard — global containment for funder-organisation users.
 *
 * Mounted once inside <Router>, above <Routes>. On every location change it:
 *
 *   1. Waits for auth + funder-membership lookups (renders children unchanged
 *      to avoid a flash of the chooser or workspace tiles).
 *   2. If the authenticated user belongs to a Funder Organisation AND the
 *      current pathname is NOT on the funder allow-list, it navigates to
 *      `/funder/workspace` with `replace: true` so the disallowed URL never
 *      enters browser history. Persisted persona selections, localStorage,
 *      sessionStorage and remembered workspace preferences are IGNORED —
 *      funders always resolve to the Funder Workspace.
 *
 * This is the single enforcement point: it runs regardless of how the URL
 * was reached (first login, refresh, deep link, back button, typed URL).
 */
import { ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useFunderMembership } from "@/hooks/use-funder-membership";
import {
  FUNDER_LANDING_PATH,
  isFunderAllowedPath,
} from "@/lib/funder-workspace/allowed-paths";

export function FunderPersonaGuard({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { isLoading: memLoading, isFunder } = useFunderMembership();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || memLoading) return;
    if (!isAuthenticated || !isFunder) return;
    if (isFunderAllowedPath(location.pathname)) {
      // Special case: `/` is allowed only as a transient landing spot for the
      // funder — immediately forward them to their workspace so they never
      // see the marketing homepage tiles or persona chooser links.
      if (location.pathname === "/" || location.pathname === "") {
        navigate(FUNDER_LANDING_PATH, { replace: true });
      }
      return;
    }
    navigate(FUNDER_LANDING_PATH, { replace: true });
  }, [
    authLoading,
    memLoading,
    isAuthenticated,
    isFunder,
    location.pathname,
    navigate,
  ]);

  return <>{children}</>;
}

export default FunderPersonaGuard;
