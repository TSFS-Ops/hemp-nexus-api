/**
 * useUnsavedChangesGuard
 *
 * Reusable guard for primary data-entry forms (MatchCompiler, KYB intake,
 * onboarding) that protects against accidental data loss via the native
 * `beforeunload` browser warning on tab close / refresh / external navigation.
 *
 * Note: in-app `<Link>` / `navigate()` interception is intentionally NOT
 * implemented here. `useBlocker` requires React Router's data router
 * (`createBrowserRouter`), and this project uses the classic `<BrowserRouter>`.
 * Adding `useBlocker` throws "useBlocker must be used within a data router".
 *
 * Usage:
 *   const { GuardDialog } = useUnsavedChangesGuard(isDirty);
 *   return (<>...form...{GuardDialog}</>);
 */

import { useEffect } from "react";

export interface UnsavedChangesGuardOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export function useUnsavedChangesGuard(
  isDirty: boolean,
  _options: UnsavedChangesGuardOptions = {},
) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // GuardDialog is a no-op placeholder so existing callers keep working.
  return { GuardDialog: null as React.ReactNode, blocker: null };
}
