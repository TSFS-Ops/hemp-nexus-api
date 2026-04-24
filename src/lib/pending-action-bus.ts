/**
 * pending-action-bus — "do this for me after I sign back in" queue.
 *
 * Problem we're solving
 * ─────────────────────
 * When a user clicks "Download waiver pack" or "Generate evidence pack" with
 * an expired session, edge-invoke fires the SessionExpiredModal and the user
 * is redirected to /auth. After re-auth they land back on the same page via
 * `?returnTo=…` — but they then have to find and re-click the original
 * button. For the recurring waiver-pack incident this was the failure mode:
 * the client couldn't tell *what* had failed and gave up.
 *
 * This module lets a download button do:
 *   const id = registerPendingAction({ kind: "waiver-packet", waiverId });
 *   try { await invoke(...); clearPendingAction(id); }
 *   catch (e) { if (sessionDead(e)) { /* modal will fire, leave queued */ } }
 *
 * On every page mount, `consumePendingActionsFor(kind)` is called once the
 * auth context reports a live session. Matching entries are dispatched back
 * to the appropriate handler, which re-runs the original work.
 *
 * Storage: sessionStorage (per-tab, cleared on close) so we never replay a
 * stale request days later. Entries also expire after 10 minutes.
 *
 * Safety
 * ──────
 *   • Each entry is keyed by `kind` + a payload-derived signature so the same
 *     button doesn't queue duplicates.
 *   • Replay only runs for the *same* origin path that registered it (no
 *     cross-page leakage).
 *   • Caller must explicitly opt in to replay by calling
 *     `consumePendingActionsFor(kind, handler)`.
 */

const STORAGE_KEY = "izenzo:pending-actions";
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export type PendingActionKind = "waiver-packet" | "evidence-pack" | "evidence-report" | "deal-certificate";

export interface PendingAction<P = Record<string, unknown>> {
  /** Stable per-tab id so registrants can clear their own entry. */
  id: string;
  kind: PendingActionKind;
  /** Path that registered the action — must match for replay. */
  path: string;
  /** Free-form payload the handler needs to re-run the work. */
  payload: P;
  /** Epoch ms when the action was queued. */
  queuedAt: number;
}

function safeRead(): PendingAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as PendingAction[]).filter((p) => p && typeof p === "object" && now - p.queuedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

function safeWrite(actions: PendingAction[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(actions));
  } catch {
    /* quota / private mode — silently no-op */
  }
}

function makeId(): string {
  // Lightweight unique id; crypto.randomUUID is widely supported in target browsers
  // but we fall back for older runtimes.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Queue an action to be replayed automatically after re-auth.
 * Returns the entry id so the caller can clear it on success.
 */
export function registerPendingAction<P extends Record<string, unknown>>(input: {
  kind: PendingActionKind;
  payload: P;
  /** Optional: override the path. Defaults to current pathname+search. */
  path?: string;
}): string {
  if (typeof window === "undefined") return "";
  const actions = safeRead();
  const path = input.path ?? window.location.pathname + window.location.search;

  // De-dupe: drop any prior entry of the same kind+path with an identical
  // payload signature so we don't replay the same download twice.
  const sig = JSON.stringify(input.payload);
  const filtered = actions.filter(
    (a) => !(a.kind === input.kind && a.path === path && JSON.stringify(a.payload) === sig)
  );

  const entry: PendingAction<P> = {
    id: makeId(),
    kind: input.kind,
    path,
    payload: input.payload,
    queuedAt: Date.now(),
  };
  safeWrite([...filtered, entry as PendingAction]);
  return entry.id;
}

/** Remove a queued action by id (call after successful execution). */
export function clearPendingAction(id: string): void {
  if (!id) return;
  const actions = safeRead();
  safeWrite(actions.filter((a) => a.id !== id));
}

/**
 * Drain queued actions of a given kind whose path matches the current page,
 * dispatching each to `handler`. Returns the number of actions dispatched.
 *
 * Handlers should be idempotent — they may also receive synthesised cache
 * hits from a previous tab if the user re-opened a closed tab quickly.
 */
export function consumePendingActionsFor<P = Record<string, unknown>>(
  kind: PendingActionKind,
  handler: (payload: P, entry: PendingAction<P>) => void | Promise<void>
): number {
  if (typeof window === "undefined") return 0;
  const all = safeRead();
  const here = window.location.pathname + window.location.search;

  const matching: PendingAction[] = [];
  const remaining: PendingAction[] = [];
  for (const a of all) {
    // Allow a loose match: the path's pathname must be the same. Query string
    // changes (e.g. expired=1 stripped after redirect) shouldn't break replay.
    const samePath = stripQuery(a.path) === stripQuery(here);
    if (a.kind === kind && samePath) {
      matching.push(a);
    } else {
      remaining.push(a);
    }
  }
  if (matching.length === 0) return 0;

  // Optimistically clear before dispatching so handler errors don't loop.
  safeWrite(remaining);

  for (const entry of matching) {
    try {
      void handler(entry.payload as P, entry as PendingAction<P>);
    } catch (err) {
      console.error("[pending-action-bus] handler threw", { kind, err });
    }
  }
  return matching.length;
}

function stripQuery(pathWithQuery: string): string {
  const idx = pathWithQuery.indexOf("?");
  return idx === -1 ? pathWithQuery : pathWithQuery.slice(0, idx);
}
