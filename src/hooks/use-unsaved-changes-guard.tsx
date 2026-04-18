/**
 * useUnsavedChangesGuard
 *
 * Reusable guard for primary data-entry forms (MatchCompiler, KYB intake,
 * onboarding) that protects against accidental data loss via:
 *
 *   1. `beforeunload` — native browser warning on tab close / refresh /
 *      external navigation.
 *   2. `useBlocker` (react-router v6.4+/v7) — intercepts in-app `<Link>`
 *      clicks and `navigate()` calls, surfacing a branded confirmation
 *      dialog before allowing the route transition.
 *
 * Usage:
 *   const { GuardDialog } = useUnsavedChangesGuard(isDirty);
 *   return (<>...form...{GuardDialog}</>);
 */

import { useEffect } from "react";
import { useBlocker } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface UnsavedChangesGuardOptions {
  /** Headline shown in the confirm dialog. */
  title?: string;
  /** Body copy shown in the confirm dialog. */
  message?: string;
  /** Label for the confirm-leave action. */
  confirmLabel?: string;
  /** Label for the cancel-stay action. */
  cancelLabel?: string;
}

const DEFAULT_TITLE = "Unsaved changes";
const DEFAULT_MESSAGE =
  "You have unsaved changes. Are you sure you want to leave? Your input will be lost.";
const DEFAULT_CONFIRM = "Leave page";
const DEFAULT_CANCEL = "Stay";

export function useUnsavedChangesGuard(
  isDirty: boolean,
  options: UnsavedChangesGuardOptions = {},
) {
  const {
    title = DEFAULT_TITLE,
    message = DEFAULT_MESSAGE,
    confirmLabel = DEFAULT_CONFIRM,
    cancelLabel = DEFAULT_CANCEL,
  } = options;

  // ── Native tab-close / refresh / external navigation guard ───────
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Most modern browsers ignore the custom string, but `returnValue`
      // is still required to trigger the native confirmation prompt.
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // ── In-app router navigation guard ────────────────────────────────
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const open = blocker.state === "blocked";

  const GuardDialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // If the user dismisses via overlay/Esc, treat as "stay".
        if (!next && blocker.state === "blocked") blocker.reset?.();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => blocker.reset?.()}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction onClick={() => blocker.proceed?.()}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { GuardDialog, blocker };
}
