/**
 * ScrollableAlertDialog
 *
 * Shared primitive for confirm dialogs with potentially long content
 * (waivers, T&Cs, multi-step forms). Guarantees on every viewport:
 *   • Header pinned at the top
 *   • Body scrolls (touch + scroll-wheel + keyboard)
 *   • Footer pinned at the bottom - Cancel / Confirm always reachable
 *   • Respects iOS safe-area top + bottom
 *   • Width caps at max-w-lg, never exceeds the viewport
 *
 * Use in place of <AlertDialogContent>+manual flex layout. Pass
 * <ScrollableAlertDialogHeader>, <ScrollableAlertDialogBody>,
 * <ScrollableAlertDialogFooter> as children.
 */
import * as React from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type ScrollableAlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Maximum width - defaults to max-w-lg. */
  maxWidthClassName?: string;
  /** Optional className appended to the dialog content shell. */
  className?: string;
  children: React.ReactNode;
};

export function ScrollableAlertDialog({
  open,
  onOpenChange,
  maxWidthClassName = "max-w-lg",
  className,
  children,
}: ScrollableAlertDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={cn(
          // Override the base `grid gap-4 p-6` so flex layout drives sizing.
          "!flex !flex-col !p-0 !gap-0 overflow-hidden",
          // Mobile: full-bleed within safe areas, no centered translate.
          "top-[max(0.5rem,env(safe-area-inset-top))] bottom-[max(0.5rem,env(safe-area-inset-bottom))] w-[calc(100vw-1rem)] translate-y-0",
          // sm+: centered card, capped at 85dvh.
          "sm:top-[50%] sm:bottom-auto sm:max-h-[85dvh] sm:translate-y-[-50%] sm:rounded-lg",
          maxWidthClassName,
          className,
        )}
      >
        {children}
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ScrollableAlertDialogHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "shrink-0 px-6 pt-6 pb-3 text-left",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * The scrollable body. Wrapped in AlertDialogDescription `asChild` so it
 * remains accessible to assistive tech. Uses `min-h-0` so flex correctly
 * lets it shrink and scroll inside the parent flex column.
 */
export function ScrollableAlertDialogBody({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <AlertDialogDescription asChild>
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-4 text-left text-sm text-muted-foreground",
          "touch-pan-y [-webkit-overflow-scrolling:touch]",
          className,
        )}
      >
        {children}
      </div>
    </AlertDialogDescription>
  );
}

export function ScrollableAlertDialogFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "shrink-0 flex flex-col-reverse gap-2 border-t border-border bg-background px-6 py-4",
        "pb-[max(1rem,env(safe-area-inset-bottom))]",
        "sm:flex-row sm:justify-end sm:space-x-2 sm:gap-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
