/**
 * Persists and restores user journey state across the authentication checkpoint.
 * Uses sessionStorage so state is scoped to the tab and auto-clears on close.
 */

const KEY = "cm_pre_auth_state";

export interface PreAuthState {
  query: string;
  selectedIds: string[];
  pendingAction: "interested";
  returnTo: string;
}

export function savePreAuthState(state: PreAuthState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked — degrade gracefully
  }
}

export function consumePreAuthState(): PreAuthState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    return JSON.parse(raw) as PreAuthState;
  } catch {
    return null;
  }
}

export function hasPreAuthState(): boolean {
  return sessionStorage.getItem(KEY) !== null;
}
