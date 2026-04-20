import { useEffect, useRef } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { toast } from "sonner";

/**
 * LegacyRedirect — explains *why* a URL changed before bouncing the user
 * to the new canonical route. Fires a single info toast on mount, preserves
 * search + hash, and supports `:matchId`-style param substitution via the
 * `resolveTo` callback.
 *
 * Use everywhere a permanent route move would otherwise be silent.
 */
interface LegacyRedirectProps {
  to: string;
  /** Optional override that receives router params and returns the final path. */
  resolveTo?: (params: Record<string, string | undefined>) => string;
  /** Short label shown in the toast, e.g. "Billing" or "Admin Console". */
  label?: string;
}

export function LegacyRedirect({ to, resolveTo, label }: LegacyRedirectProps) {
  const location = useLocation();
  const params = useParams();
  const firedRef = useRef(false);

  const finalPath = resolveTo
    ? `${resolveTo(params)}${location.search}${location.hash}`
    : `${to}${location.search}${location.hash}`;

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    const fromPath = location.pathname;
    // Only toast once per browser session per origin path, so users who already
    // saw the notice don't get re-nagged on every click of an old bookmark.
    const sessionKey = `legacy-redirect-toast:${fromPath}`;
    if (typeof window !== "undefined" && sessionStorage.getItem(sessionKey)) {
      return;
    }
    if (typeof window !== "undefined") {
      sessionStorage.setItem(sessionKey, "1");
    }
    toast.info(
      label ? `${label} has moved` : "This page has moved",
      {
        description: `Update your bookmarks: ${fromPath} now lives at ${finalPath.split("?")[0].split("#")[0]}.`,
        duration: 3500,
      }
    );
  }, [location.pathname, finalPath, label]);

  return <Navigate to={finalPath} replace />;
}
