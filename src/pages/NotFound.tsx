import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Check, AlertTriangle } from "lucide-react";

/**
 * Suggest the closest sensible destination based on the URL the user
 * actually hit. The previous 404 dumped everyone at /dashboard regardless
 * of intent, which made it useless for the most common failure mode -
 * a broken in-app CTA pointing into a sub-shell that nearly exists
 * (e.g. /desk/initiate, /desk/setings/company, /hq/users-typo).
 *
 * Each suggestion is a real, registered route (kept in lockstep with
 * scripts/check-routes.mjs). If we recognise the prefix, the primary CTA
 * goes to the shell's overview; if not, we fall back to the home page.
 */
function suggestDestination(pathname: string): {
  href: string;
  label: string;
  reason: string;
} {
  if (pathname.startsWith("/desk")) {
    return {
      href: "/desk",
      label: "Open Trade Desk",
      reason:
        "It looks like you were trying to reach a Trade Desk surface. We'll take you to your desk overview.",
    };
  }
  if (pathname.startsWith("/hq")) {
    return {
      href: "/hq",
      label: "Open Admin Console",
      reason:
        "It looks like you were trying to reach an admin surface. We'll take you to the Admin Console.",
    };
  }
  if (pathname.startsWith("/developer")) {
    return {
      href: "/developer/keys",
      label: "Open Developer Center",
      reason:
        "It looks like you were trying to reach a developer tool. We'll take you to the Developer Center.",
    };
  }
  if (pathname.startsWith("/governance")) {
    return {
      href: "/governance/triage",
      label: "Open Governance Console",
      reason:
        "It looks like you were trying to reach the Governance Console. We'll take you to Triage.",
    };
  }
  if (pathname.startsWith("/docs")) {
    return {
      href: "/docs",
      label: "Open documentation",
      reason:
        "That documentation page does not exist. We'll take you to the docs index.",
    };
  }
  return {
    href: "/",
    label: "Go to home",
    reason: "We couldn't match the address to any known page.",
  };
}

/**
 * 404 page - shown by the catch-all `<Route path="*">` in App.tsx and by
 * RouteErrorBoundary when a lazy-loaded chunk fails to load.
 *
 * Goals (in order):
 *  1. Tell the user *which* path failed so a misfired CTA is visible to
 *     them and to anyone they report it to. The previous version hid the
 *     URL entirely, which made bug reports nearly useless.
 *  2. Offer the closest sensible recovery destination based on the prefix
 *     they actually hit, not a one-size-fits-all "Dashboard" button.
 *  3. Provide a copy-URL affordance for support tickets.
 */
export default function NotFound() {
  const location = useLocation();
  const path = `${location.pathname}${location.search}${location.hash}`;
  const suggestion = suggestDestination(location.pathname);
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable - ignore silently */
    }
  };

  return (
    <main
      role="main"
      className="min-h-screen flex items-center justify-center bg-background px-6 py-12"
    >
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" aria-hidden />
          </div>
          <div>
            <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-muted-foreground">
              Error 404
            </p>
            <h1 className="text-xl font-semibold text-foreground">
              That page isn't here
            </h1>
          </div>
        </div>

        <p className="text-sm text-muted-foreground mb-2">{suggestion.reason}</p>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 mb-6">
          <p className="font-mono text-xs text-muted-foreground break-all">
            <span className="text-muted-foreground/60">Address requested:</span>{" "}
            <span className="text-foreground">{path}</span>
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <Button asChild className="sm:flex-1">
            <Link to={suggestion.href}>
              <ArrowLeft className="h-4 w-4 mr-2" aria-hidden />
              {suggestion.label}
            </Link>
          </Button>
          <Button
            variant="outline"
            onClick={copyUrl}
            aria-label="Copy the address that failed, useful when reporting the issue"
          >
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-2" aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" aria-hidden />
                Copy address
              </>
            )}
          </Button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          If you reached this page from a button or link inside Izenzo, please
          report it - that's a defect on our side, not yours.
        </p>
      </div>
    </main>
  );
}
