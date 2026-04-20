import { useEffect, useRef } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * LegacyRedirect — explains *why* a URL changed before bouncing the user
 * to the new canonical route.
 *
 * UX contract (post-2026-04 hardening):
 *   1. The from-path → to-path mapping is recorded in sessionStorage under
 *      `legacy-redirect:notice` BEFORE we navigate.
 *   2. A global <LegacyRedirectBanner /> mounted at the app root reads that
 *      key on every route change and shows a persistent, dismissable info bar
 *      at the top of the page. The banner stays visible until the user
 *      dismisses it (or navigates away from the destination).
 *   3. We do NOT show a toast — toasts auto-dismiss in 3.5s and the user can
 *      easily miss them, especially on slow Match Details loads.
 *   4. We never show the same notice twice in a single session for the same
 *      from-path (`legacy-redirect:seen:<fromPath>` flag).
 *
 * This means the user sees the explanation:
 *   • Persistently at the top of the destination page (until dismissed)
 *   • In the route they actually land on, after any data has loaded
 *   • Without any race against the page's own loading spinner
 */
interface LegacyRedirectProps {
  to: string;
  /** Optional override that receives router params and returns the final path. */
  resolveTo?: (params: Record<string, string | undefined>) => string;
  /** Short label shown in the banner, e.g. "Billing" or "Match Details". */
  label?: string;
}

export const LEGACY_REDIRECT_NOTICE_KEY = "legacy-redirect:notice";
export const LEGACY_REDIRECT_SEEN_PREFIX = "legacy-redirect:seen:";

export interface LegacyRedirectNotice {
  fromPath: string;
  toPath: string;
  label: string;
  recordedAt: number;
}

export function LegacyRedirect({ to, resolveTo, label }: LegacyRedirectProps) {
  const location = useLocation();
  const params = useParams();
  const recordedRef = useRef(false);

  const finalPath = resolveTo
    ? `${resolveTo(params)}${location.search}${location.hash}`
    : `${to}${location.search}${location.hash}`;

  useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;
    if (typeof window === "undefined") return;

    const fromPath = location.pathname;
    const seenKey = `${LEGACY_REDIRECT_SEEN_PREFIX}${fromPath}`;

    // Already shown this session for this exact legacy path — stay silent.
    if (sessionStorage.getItem(seenKey)) return;

    const notice: LegacyRedirectNotice = {
      fromPath,
      toPath: finalPath.split("?")[0].split("#")[0],
      label: label ?? "This page",
      recordedAt: Date.now(),
    };

    try {
      sessionStorage.setItem(LEGACY_REDIRECT_NOTICE_KEY, JSON.stringify(notice));
      sessionStorage.setItem(seenKey, "1");
    } catch {
      // Storage unavailable (private mode quota) — silently degrade. The
      // navigation itself still works; only the explanatory banner is lost.
    }
  }, [location.pathname, finalPath, label]);

  return <Navigate to={finalPath} replace />;
}
