/**
 * useUnsavedChanges — warns users before they leave a page with unsaved form data.
 *
 * Handles:
 * - Browser tab close / refresh (beforeunload)
 * - Provides a `confirmDiscard` helper for in-app navigation guards
 *
 * Usage:
 *   const { confirmDiscard } = useUnsavedChanges(isDirty);
 */

import { useEffect, useCallback } from "react";

export function useUnsavedChanges(isDirty: boolean) {
  // Browser-level: warn on tab close / refresh
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom messages but still show a prompt
      e.returnValue = "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // In-app: call this before programmatic navigation or dialog close
  const confirmDiscard = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm(
      "You have unsaved changes. Are you sure you want to leave? Your changes will be lost."
    );
  }, [isDirty]);

  return { confirmDiscard, isDirty };
}
