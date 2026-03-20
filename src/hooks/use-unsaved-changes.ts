/**
 * useUnsavedChanges — warns users before they leave a page with unsaved form data.
 *
 * Handles:
 * - Browser tab close / refresh (beforeunload)
 * - Provides a `confirmDiscard` helper for programmatic guards
 *
 * Note: useBlocker requires a data router (createBrowserRouter). Since this app
 * uses BrowserRouter, we rely on beforeunload only for navigation guards.
 */

import { useEffect, useCallback } from "react";

export function useUnsavedChanges(isDirty: boolean) {
  // Browser-level: warn on tab close / refresh
  useEffect(() => {
    if (!isDirty) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
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
