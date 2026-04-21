/**
 * SafeSelect
 * ──────────
 * A thin error-reporting wrapper around the shared shadcn `Select` primitive.
 *
 * Why this exists:
 *   Radix's Select renders its menu through a portal. If anything inside the
 *   portal throws (or if a global error fires while the menu is opening),
 *   the dropdown can silently fail to appear with no UI feedback.
 *
 *   This wrapper:
 *     1. Catches render-time errors inside the trigger/content tree and
 *        surfaces them as a `toast.error(...)` with the underlying message.
 *     2. Listens for `window.error` and `unhandledrejection` while the menu
 *        is open and surfaces those too.
 *     3. Logs a structured warning to the console so the original stack is
 *        preserved for debugging.
 *
 * Drop-in compatible with the existing `<Select>` API — pass a `label` prop
 * to give the toast a human-readable origin (e.g. "Contact method").
 */

import * as React from "react";
import { Select } from "@/components/ui/select";
import { toast } from "sonner";

interface SafeSelectProps extends React.ComponentProps<typeof Select> {
  /** Human-readable label used in error toasts (e.g. "Contact method"). */
  label?: string;
  children: React.ReactNode;
}

interface SafeSelectBoundaryState {
  hasError: boolean;
  message: string;
}

class SafeSelectBoundary extends React.Component<
  { label: string; children: React.ReactNode },
  SafeSelectBoundaryState
> {
  state: SafeSelectBoundaryState = { hasError: false, message: "" };

  static getDerivedStateFromError(error: unknown): SafeSelectBoundaryState {
    const message = error instanceof Error ? error.message : String(error);
    return { hasError: true, message };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[SafeSelect:${this.props.label}] render error`, {
      message,
      componentStack: info.componentStack,
      error,
    });
    toast.error(`${this.props.label} dropdown failed`, {
      description: message,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex h-10 w-full items-center rounded-md border border-destructive/50 bg-destructive/5 px-3 text-sm text-destructive"
        >
          Dropdown unavailable — {this.state.message}
        </div>
      );
    }
    return this.props.children;
  }
}

export function SafeSelect({ label = "Dropdown", children, onOpenChange, ...rest }: SafeSelectProps) {
  // Track whether the menu is open so we only attach window listeners while
  // the portal is mounted. This avoids surfacing unrelated errors as Select
  // failures.
  const openRef = React.useRef(false);

  React.useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      if (!openRef.current) return;
      const message = event.error instanceof Error ? event.error.message : event.message;
      console.warn(`[SafeSelect:${label}] window error while open`, event.error || event.message);
      toast.error(`${label} dropdown error`, { description: message });
    };
    const handleRejection = (event: PromiseRejectionEvent) => {
      if (!openRef.current) return;
      const reason = event.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      console.warn(`[SafeSelect:${label}] unhandled rejection while open`, reason);
      toast.error(`${label} dropdown error`, { description: message });
    };
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, [label]);

  return (
    <SafeSelectBoundary label={label}>
      <Select
        {...rest}
        onOpenChange={(open) => {
          openRef.current = open;
          try {
            onOpenChange?.(open);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`[SafeSelect:${label}] onOpenChange handler threw`, err);
            toast.error(`${label} dropdown handler failed`, { description: message });
          }
        }}
      >
        {children}
      </Select>
    </SafeSelectBoundary>
  );
}
