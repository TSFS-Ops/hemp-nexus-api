/**
 * WaiverPacketDownloadButton — Fetches a short-lived signed URL for the POI
 * evidence waiver packet PDF and triggers the browser download.
 *
 * Failure handling
 * ────────────────
 *   • Inline `DownloadErrorState` with "Try again" replaces silent failures.
 *   • If the failure is a dead-session error (UNAUTHORIZED / NO_SESSION /
 *     REFRESH_FAILED), we queue a pending retry via `pending-action-bus`
 *     before letting the global SessionExpiredModal redirect to /auth.
 *     After the user signs back in and lands on the same path, the queued
 *     retry runs automatically — no second click needed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { invokeEdgeFunction, isSessionExpiredError } from "@/lib/edge-invoke";
import { Button } from "@/components/ui/button";
import { DownloadErrorState } from "./DownloadErrorState";
import { useAuth } from "@/contexts/AuthContext";
import {
  registerPendingAction,
  clearPendingAction,
  consumePendingActionsFor,
} from "@/lib/pending-action-bus";

interface Props {
  waiverId: string;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  label?: string;
  className?: string;
}

interface WaiverPacketPayload extends Record<string, unknown> {
  waiverId: string;
}

export function WaiverPacketDownloadButton({
  waiverId,
  variant = "outline",
  size = "sm",
  label = "Download waiver packet",
  className,
}: Props) {
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  // Track the pending-action id so we can clear it on success.
  const pendingIdRef = useRef<string | null>(null);

  const runDownload = useCallback(
    async (opts?: { auto?: boolean }) => {
      setLoading(true);
      setError(null);
      // Optimistically queue a pending retry. If we succeed we clear it.
      // If we hit a dead-session error, the modal will redirect; on return
      // the queued entry replays this same handler.
      pendingIdRef.current = registerPendingAction<WaiverPacketPayload>({
        kind: "waiver-packet",
        payload: { waiverId },
      });

      try {
        console.log("[WaiverPacketDownload] invoking waiver-packet for", waiverId, opts);
        const data = await invokeEdgeFunction<{ url?: string }>("waiver-packet", {
          body: { waiver_id: waiverId },
          label: "download waiver packet",
        });
        const url = data?.url;
        if (!url) throw new Error("No signed URL returned by waiver-packet function");

        const pdfResp = await fetch(url);
        if (!pdfResp.ok) {
          throw new Error(`Could not fetch waiver packet (HTTP ${pdfResp.status}).`);
        }
        const blob = await pdfResp.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = `waiver-packet-${waiverId}.pdf`;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);

        // Success — clear the queued retry.
        if (pendingIdRef.current) clearPendingAction(pendingIdRef.current);
        pendingIdRef.current = null;
        toast.success(opts?.auto ? "Waiver packet downloaded (resumed after sign-in)" : "Waiver packet downloaded");
      } catch (err) {
        const msg = (err as Error).message || "Failed to fetch waiver packet";
        console.error("[WaiverPacketDownload] failed", err);
        if (isSessionExpiredError(err)) {
          // Leave the pending action queued — it will replay automatically
          // after re-auth. Don't show the inline error state because the
          // SessionExpiredModal is about to take the screen.
          setError(null);
        } else {
          // Non-auth failures: clear the queued retry so we don't replay
          // a doomed call after the next sign-in.
          if (pendingIdRef.current) clearPendingAction(pendingIdRef.current);
          pendingIdRef.current = null;
          setError(err);
          toast.error(msg, { duration: 6000 });
        }
      } finally {
        setLoading(false);
      }
    },
    [waiverId]
  );

  // After re-auth (session becomes available again), drain any queued
  // waiver-packet retries scoped to this page.
  useEffect(() => {
    if (!session) return;
    consumePendingActionsFor<WaiverPacketPayload>("waiver-packet", (payload) => {
      if (payload.waiverId !== waiverId) return;
      void runDownload({ auto: true });
    });
  }, [session, waiverId, runDownload]);

  const handleClick = () => {
    if (loading) return;
    void runDownload();
  };

  return (
    <div className={"space-y-2 " + (className ?? "")}>
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={loading}
        className={error ? "w-full" : undefined}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Download className="h-4 w-4 mr-2" />
        )}
        {label}
      </Button>

      {error && !loading && (
        <DownloadErrorState
          title="Couldn't download waiver packet"
          error={error}
          onRetry={handleClick}
          retrying={loading}
        />
      )}
    </div>
  );
}
