/**
 * InlineLoader — Single source of truth for inline/section-level loading states.
 *
 * Replaces the 20+ scattered patterns of:
 *   <div className="text-center py-8 text-muted-foreground">
 *     <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
 *     Loading...
 *   </div>
 *
 * For full-page loading, use <FullPageLoader /> instead.
 *
 * Usage:
 *   <InlineLoader />
 *   <InlineLoader message="Loading documents..." />
 */

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineLoaderProps {
  message?: string;
  className?: string;
}

export function InlineLoader({ message = "Loading…", className }: InlineLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-8 text-muted-foreground", className)}>
      <Loader2 className="h-6 w-6 animate-spin mb-2" />
      <p className="text-sm">{message}</p>
    </div>
  );
}
