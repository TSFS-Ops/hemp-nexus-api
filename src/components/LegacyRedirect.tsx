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
    toast.info(
      label
        ? `${label} has moved`
        : "This page has moved",
      {
        description: `${fromPath} → ${finalPath.split("?")[0].split("#")[0]}. Update your bookmarks to avoid this redirect next time.`,
        duration: 6000,
      }
    );
  }, [location.pathname, finalPath, label]);

  return <Navigate to={finalPath} replace />;
}
