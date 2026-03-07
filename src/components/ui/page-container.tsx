/**
 * PageContainer — Single source of truth for page-level max-width and padding.
 *
 * Replaces the scattered patterns of:
 *   <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
 *   <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
 *   <div className="max-w-6xl mx-auto px-4 sm:px-6">
 *
 * Usage:
 *   <PageContainer>                       → max-w-5xl (default)
 *   <PageContainer size="wide">           → max-w-6xl
 *   <PageContainer size="narrow">         → max-w-4xl
 *   <PageContainer size="compact">        → max-w-3xl
 */

import { ReactNode } from "react";
import { cn } from "@/lib/utils";

const sizes = {
  compact: "max-w-3xl",
  narrow: "max-w-4xl",
  default: "max-w-5xl",
  wide: "max-w-6xl",
  ultra: "max-w-7xl",
} as const;

interface PageContainerProps {
  children: ReactNode;
  size?: keyof typeof sizes;
  className?: string;
  /** Whether to include vertical padding (default: true) */
  padY?: boolean;
}

export function PageContainer({
  children,
  size = "default",
  className,
  padY = true,
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-3 xs:px-4 sm:px-6",
        sizes[size],
        padY && "py-4 sm:py-6 lg:py-8",
        className
      )}
    >
      {children}
    </div>
  );
}
