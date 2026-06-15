/**
 * AdminRedirectOriginBanner
 * -------------------------
 * Persistent, dismissable notice rendered at the top of HQ when a platform
 * admin was redirected here from a deep link they originally clicked
 * (e.g. a Resend notification opened in a logged-in admin session).
 *
 * Why: the previous explanation was a 10-second toast in the corner - easy
 * to miss while pasting / context-switching. This banner stays visible
 * until the admin either opens the original link or dismisses it, closing
 * the "I clicked X but landed at Y with no explanation" failure mode the
 * client raised.
 *
 * Source of truth: sessionStorage key `izenzo_admin_redirect_origin` set
 * by `src/pages/Auth.tsx` after admin override resolves to /hq.
 */
import { useEffect, useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "izenzo_admin_redirect_origin";

interface Origin {
  link: string;
  at: number;
}

export function AdminRedirectOriginBanner() {
  const [origin, setOrigin] = useState<Origin | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Origin;
      // Clear records older than 24h - stale state should not haunt the UI.
      if (!parsed.link || Date.now() - parsed.at > 24 * 60 * 60 * 1000) {
        sessionStorage.removeItem(KEY);
        return;
      }
      setOrigin(parsed);
    } catch {
      /* malformed entry - ignore */
    }
  }, []);

  if (!origin) return null;

  const dismiss = () => {
    try { sessionStorage.removeItem(KEY); } catch { /* no-op */ }
    setOrigin(null);
  };

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <Link2 className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 space-y-1">
        <p className="font-medium">
          You were redirected to HQ because admin sessions always land here.
        </p>
        <p className="text-xs">
          The link you originally opened was{" "}
          <a
            href={origin.link}
            className="underline underline-offset-2 hover:no-underline"
            onClick={dismiss}
          >
            {origin.link}
          </a>
          . Open it manually if you intended to view that page as an admin.
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={dismiss}
        aria-label="Dismiss"
        className="h-7 w-7 shrink-0 text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
