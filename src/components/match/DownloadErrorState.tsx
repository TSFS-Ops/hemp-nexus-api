/**
 * DownloadErrorState — Inline, on-page error UI for failed pack/certificate
 * generation. Replaces silent failures (and easy-to-miss corner toasts) with
 * a persistent, in-flow message that includes:
 *   • a human title and explanation,
 *   • the underlying error code/status (when known) for support diagnosis,
 *   • a "Try again" button.
 *
 * Sized to drop into existing card layouts (waiver download row, evidence
 * pack panel, deal certificate block).
 */
import { AlertTriangle, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EdgeInvokeError } from "@/lib/edge-invoke";

export interface DownloadErrorInfo {
  /** Short human title, e.g. "Couldn't generate waiver packet". */
  title: string;
  /** Human-readable cause (defaults to error.message). */
  message?: string;
  /** Underlying error – used to extract status/code/serverBody. */
  error?: unknown;
}

interface DownloadErrorStateProps extends DownloadErrorInfo {
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}

function describeError(error: unknown): { code?: string; status?: number; serverBody?: string; fallback: string } {
  if (error instanceof EdgeInvokeError) {
    return {
      code: error.code,
      status: error.status,
      serverBody: error.serverBody,
      fallback: error.message,
    };
  }
  if (error instanceof Error) return { fallback: error.message };
  if (typeof error === "string") return { fallback: error };
  return { fallback: "Unknown error" };
}

export function DownloadErrorState({
  title,
  message,
  error,
  onRetry,
  retrying = false,
  className,
}: DownloadErrorStateProps) {
  const info = describeError(error);
  const detail = message || info.fallback;
  // Show a compact diagnostic line so support can correlate with logs.
  const diagBits: string[] = [];
  if (info.code) diagBits.push(info.code);
  if (info.status) diagBits.push(`HTTP ${info.status}`);
  const diag = diagBits.join(" · ");

  return (
    <div
      role="alert"
      aria-live="polite"
      className={
        "rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3 " +
        (className ?? "")
      }
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" aria-hidden />
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-sm font-semibold text-destructive">{title}</p>
          <p className="text-sm text-foreground/80 break-words">{detail}</p>
          {diag && (
            <p className="text-[11px] font-mono text-muted-foreground">
              Reference: {diag}
            </p>
          )}
          {info.serverBody && info.serverBody.length < 400 && (
            <details className="text-[11px] text-muted-foreground">
              <summary className="cursor-pointer select-none">Show technical detail</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all bg-muted/50 p-2 rounded">
                {info.serverBody}
              </pre>
            </details>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
              Retrying…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              Try again
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
