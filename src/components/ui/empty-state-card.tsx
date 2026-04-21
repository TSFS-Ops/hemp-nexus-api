/**
 * EmptyStateCard - institutional empty-state primitive.
 *
 * Used when an authenticated org has zero data on a structural surface
 * (no matches, no disputes, no KYB record). Distinct from the inline
 * EmptyState in error-state.tsx which is for filtered / "no results"
 * cases inside an existing data view.
 *
 * Design contract:
 * - Surface: subtle muted card on neutral border, generous padding.
 * - Hierarchy: kicker → title → description → primary CTA (heavy) → optional secondary.
 * - Tokens only - no raw slate-* colours so the component theme-shifts cleanly.
 * - Copy is the caller's responsibility; component enforces structure, not voice.
 */

import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface EmptyStateCardAction {
  label: string;
  onClick: () => void;
}

export interface EmptyStateCardProps {
  /** Small uppercase label above the title. Optional. */
  kicker?: string;
  /** Single short sentence. Title-case, Institutional British English. */
  title: string;
  /** One or two sentences describing the missing state and the next action. */
  description: string;
  /** Optional icon (lucide-react) rendered in a muted circular badge. */
  icon?: ReactNode;
  /** Primary action - rendered with heavy primary styling. */
  primaryAction?: EmptyStateCardAction;
  /** Optional secondary action - rendered as ghost link. */
  secondaryAction?: EmptyStateCardAction;
  /** Layout density. `compact` is for in-column lane empties; `default` for full-page. */
  density?: "default" | "compact";
  className?: string;
}

export function EmptyStateCard({
  kicker,
  title,
  description,
  icon,
  primaryAction,
  secondaryAction,
  density = "default",
  className,
}: EmptyStateCardProps) {
  const isCompact = density === "compact";

  return (
    <div
      className={cn(
        // Base: subtle surface, soft border, mild radius, no heavy shadow.
        "rounded-md border border-border bg-muted/40 text-center",
        isCompact ? "p-6" : "p-10 sm:p-12",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "mx-auto mb-4 inline-flex items-center justify-center rounded-full bg-background border border-border text-muted-foreground",
            isCompact ? "h-9 w-9" : "h-11 w-11",
          )}
        >
          {icon}
        </div>
      )}

      {kicker && (
        <p
          className={cn(
            "font-mono uppercase tracking-widest text-muted-foreground",
            isCompact ? "text-[10px] mb-2" : "text-[11px] mb-3",
          )}
        >
          {kicker}
        </p>
      )}

      <h3
        className={cn(
          "font-semibold text-foreground tracking-tight",
          isCompact ? "text-sm" : "text-lg sm:text-xl",
        )}
      >
        {title}
      </h3>

      <p
        className={cn(
          "mx-auto mt-2 text-muted-foreground leading-relaxed",
          isCompact ? "text-xs max-w-xs" : "text-sm max-w-md",
        )}
      >
        {description}
      </p>

      {(primaryAction || secondaryAction) && (
        <div
          className={cn(
            "mt-6 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-3",
            isCompact && "mt-4",
          )}
        >
          {primaryAction && (
            <Button
              type="button"
              size={isCompact ? "sm" : "default"}
              onClick={primaryAction.onClick}
              // `default` variant uses bg-primary which is the heavy institutional dark-slate token.
              className="font-medium"
            >
              {primaryAction.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              type="button"
              size={isCompact ? "sm" : "default"}
              variant="ghost"
              onClick={secondaryAction.onClick}
              className="text-muted-foreground hover:text-foreground"
            >
              {secondaryAction.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
