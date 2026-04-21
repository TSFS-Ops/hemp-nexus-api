import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Info, X } from "lucide-react";
import {
  LEGACY_REDIRECT_NOTICE_KEY,
  type LegacyRedirectNotice,
} from "./LegacyRedirect";

/**
 * LegacyRedirectBanner
 * ────────────────────
 * Persistent, dismissable banner shown at the top of the viewport whenever a
 * user has just been bounced from a retired URL to its canonical replacement.
 *
 * The banner reads `legacy-redirect:notice` from sessionStorage (written by
 * <LegacyRedirect />), surfaces a clear explanation with both the old and the
 * new path, and stays visible until:
 *   • the user clicks Dismiss, or
 *   • the user navigates away from the destination route
 *
 * It is mounted ONCE at the app root, sits above all page content (z-[200],
 * above the floating bell at z-[100]), and is fully accessible (role=status,
 * aria-live=polite).
 *
 * Robustness:
 *   • Stale notices (>10 minutes old) are ignored to avoid surprising users
 *     who restored a tab.
 *   • Dismissal is tracked per from-path in sessionStorage so the banner
 *     does not reappear if the user navigates back into the same legacy
 *     path within the session.
 */
export function LegacyRedirectBanner() {
  const location = useLocation();
  const [notice, setNotice] = useState<LegacyRedirectNotice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const raw = sessionStorage.getItem(LEGACY_REDIRECT_NOTICE_KEY);
    if (!raw) {
      setNotice(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as LegacyRedirectNotice;
      // Stale notice (>10 min) - drop it.
      if (Date.now() - parsed.recordedAt > 10 * 60 * 1000) {
        sessionStorage.removeItem(LEGACY_REDIRECT_NOTICE_KEY);
        setNotice(null);
        return;
      }
      // Only surface on the destination route - once user navigates away,
      // we clear the notice automatically.
      if (location.pathname === parsed.toPath) {
        setNotice(parsed);
      } else {
        sessionStorage.removeItem(LEGACY_REDIRECT_NOTICE_KEY);
        setNotice(null);
      }
    } catch {
      sessionStorage.removeItem(LEGACY_REDIRECT_NOTICE_KEY);
      setNotice(null);
    }
  }, [location.pathname]);

  if (!notice) return null;

  const dismiss = () => {
    if (typeof window !== "undefined") {
      sessionStorage.removeItem(LEGACY_REDIRECT_NOTICE_KEY);
    }
    setNotice(null);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-[200] bg-amber-50 border-b border-amber-200 shadow-sm"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-start sm:items-center gap-3">
        <Info
          className="h-4 w-4 mt-0.5 sm:mt-0 shrink-0 text-amber-700"
          strokeWidth={2}
        />
        <div className="flex-1 min-w-0 text-[13px] text-amber-900">
          <span className="font-semibold">{notice.label} has moved.</span>{" "}
          <span className="hidden sm:inline">
            <code className="font-mono text-[12px] text-amber-800">{notice.fromPath}</code>
            {" → "}
            <code className="font-mono text-[12px] text-amber-800">{notice.toPath}</code>
            . Please update any saved bookmarks.
          </span>
          <span className="sm:hidden block mt-0.5 font-mono text-[11px] text-amber-800 truncate">
            {notice.toPath}
          </span>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 p-1 rounded hover:bg-amber-100 transition-colors text-amber-700 hover:text-amber-900"
          aria-label="Dismiss redirect notice"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
