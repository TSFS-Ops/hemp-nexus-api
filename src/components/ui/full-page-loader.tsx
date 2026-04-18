/**
 * FullPageLoader - Single source of truth for full-screen loading states.
 *
 * Replaces the 8+ scattered patterns of:
 *   <div className="flex items-center justify-center min-h-screen">
 *     <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
 *   </div>
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FullPageLoaderProps {
  /** Optional message below the spinner */
  message?: string;
  className?: string;
}

export function FullPageLoader({ message, className }: FullPageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white",
        className
      )}
    >
      <p className="font-mono text-[11px] tracking-[0.4em] uppercase text-slate-900">
        IZENZO
      </p>
      <Loader2 className="h-8 w-8 animate-spin text-emerald-600" strokeWidth={2} />
      {message && <p className="text-sm text-slate-500">{message}</p>}
      <span className="sr-only">Verifying your session…</span>
    </div>
  );
}
