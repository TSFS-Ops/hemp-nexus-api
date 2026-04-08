/**
 * LoadingButton - Canonical button with built-in loading spinner.
 *
 * Replaces the repeated pattern of:
 *   <Button disabled={loading} onClick={...}>
 *     {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save"}
 *   </Button>
 *
 * Usage:
 *   <LoadingButton loading={saving} onClick={handleSave}>Save</LoadingButton>
 *   <LoadingButton loading={deleting} variant="destructive" loadingText="Deleting…">Delete</LoadingButton>
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface LoadingButtonProps extends ButtonProps {
  /** When true, shows spinner, disables button, and prevents double-click */
  loading?: boolean;
  /** Text to show while loading. Defaults to children. */
  loadingText?: string;
  /** Icon to show before children when not loading */
  icon?: React.ReactNode;
}

export const LoadingButton = React.forwardRef<HTMLButtonElement, LoadingButtonProps>(
  ({ loading = false, loadingText, icon, children, disabled, ...props }, ref) => {
    return (
      <Button ref={ref} disabled={disabled || loading} {...props}>
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingText ?? children}
          </>
        ) : (
          <>
            {icon}
            {children}
          </>
        )}
      </Button>
    );
  }
);
LoadingButton.displayName = "LoadingButton";
