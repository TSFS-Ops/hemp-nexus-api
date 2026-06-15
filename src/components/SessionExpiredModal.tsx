/**
 * SessionExpiredModal - global, blocking re-auth prompt.
 *
 * Mounted once in App.tsx. Listens to the `izenzo:session-force-reauth`
 * event (see src/lib/session-expiry-bus.ts) and opens an unmissable modal
 * with a single "Sign in again" CTA that preserves the current path via
 * ?returnTo=, so the user lands back on the same screen after re-auth.
 *
 * Why a modal (not a toast):
 * Toasts in the bottom-right are easy to miss; the previous incident had
 * a client repeatedly clicking "Download waiver pack" without noticing
 * the small "Your session has expired" toast. A modal forces the issue
 * to be addressed before any further interaction.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { LogIn } from "lucide-react";
import { onSessionExpired, type SessionExpiryReason } from "@/lib/session-expiry-bus";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const REASON_COPY: Record<SessionExpiryReason, string> = {
  UNAUTHORIZED:
    "Your sign-in session has expired. To protect your account, please sign in again to continue.",
  NO_SESSION:
    "We couldn't find an active sign-in session. Please sign in again to continue.",
  REFRESH_FAILED:
    "Your sign-in session could not be renewed. Please sign in again to continue.",
  HEALTH_CHECK_FAILED:
    "Your sign-in session has expired in the background. Please sign in again to continue.",
};

export function SessionExpiredModal() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<SessionExpiryReason>("UNAUTHORIZED");
  const [requestId, setRequestId] = useState<string | undefined>();
  const [signingIn, setSigningIn] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    return onSessionExpired((detail) => {
      // If the user is already on the auth page, no need to interrupt.
      if (window.location.pathname.startsWith("/auth")) return;
      setReason(detail.reason);
      setRequestId(detail.requestId);
      setOpen(true);
    });
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith("/auth")) {
      setOpen(false);
      setSigningIn(false);
    }
  }, [location.pathname]);

  const handleSignInAgain = async () => {
    if (signingIn) return;
    setSigningIn(true);
    // Best-effort: clear any stale Supabase session so the auth page is clean.
    try {
      await supabase.auth.signOut();
    } catch {
      /* ignore - session was already invalid */
    }
    const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/auth?returnTo=${returnTo}&expired=1`;
  };

  const handleCopyRequestId = async () => {
    if (!requestId) return;
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <AlertDialog open={open}>
      {/* No onOpenChange - this modal is intentionally non-dismissable.
          The only way out is to re-authenticate. */}
      {/* AlertDialog (vs Dialog) does not close on outside click by design.
          We additionally block ESC so the only exit is the CTA below. */}
      <AlertDialogContent
        className="max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Session expired</AlertDialogTitle>
          <AlertDialogDescription>{REASON_COPY[reason]}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
          <p className="font-medium mb-1">Your work is being preserved.</p>
          <p>
            Trade form fields that support draft recovery - new-trade search,
            deal terms, deal notes, and document title/notes/visibility - are
            saved in this browser tab and will reappear after you sign in again.
          </p>
          <p className="mt-1">
            <span className="font-medium">File uploads in progress will not complete:</span>{" "}
            browsers do not allow file selections to be saved across page reloads
            for security reasons. If you were attaching a document, you will need
            to re-select it after signing in.
          </p>
        </div>
        {requestId && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="text-muted-foreground mb-1">
              Reference ID (include this when reporting the issue):
            </div>
            <div className="flex items-center justify-between gap-2">
              <code className="font-mono text-[11px] break-all">{requestId}</code>
              <button
                type="button"
                onClick={handleCopyRequestId}
                className="shrink-0 text-primary hover:underline"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        )}
        <AlertDialogFooter>
          <Button onClick={handleSignInAgain} disabled={signingIn} className="w-full sm:w-auto">
            <LogIn className="h-4 w-4 mr-2" />
            {signingIn ? "Redirecting…" : "Sign in again"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
