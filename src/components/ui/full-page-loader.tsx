/**
 * FullPageLoader — Single source of truth for full-screen loading states.
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
    <div className={cn("flex flex-col items-center justify-center min-h-screen gap-3", className)}>
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
