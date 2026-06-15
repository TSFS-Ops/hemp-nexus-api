/**
 * Session-scoped persistence for the last attestation error per WaD.
 *
 * Why sessionStorage: the error is only useful within the same browser tab -
 * a fresh tab or a closed/reopened browser shouldn't resurface a stale error,
 * but a page reload (e.g. after the user navigates away and back, or after an
 * unrelated refresh) should still show the last failure with its Reference ID
 * so they can copy it and contact support.
 *
 * Scoped per `wadId` so multiple deals don't cross-contaminate.
 */

export type PersistedAttestErrorKind =
  | "auth_required"
  | "client_error"
  | "server_error"
  | "network_error"
  | "unknown";

export interface PersistedAttestError {
  message: string;
  requestId?: string;
  kind?: PersistedAttestErrorKind;
  /** Epoch ms - used to age out very old entries (defensive). */
  savedAt: number;
}

const KEY_PREFIX = "wad:attestError:";
/** Drop entries older than 24h - past that they're rarely actionable. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function key(wadId: string): string {
  return `${KEY_PREFIX}${wadId}`;
}

export function loadAttestError(wadId: string): PersistedAttestError | null {
  const s = storage();
  if (!s || !wadId) return null;
  try {
    const raw = s.getItem(key(wadId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedAttestError>;
    if (!parsed || typeof parsed.message !== "string") return null;
    if (typeof parsed.savedAt === "number" && Date.now() - parsed.savedAt > MAX_AGE_MS) {
      s.removeItem(key(wadId));
      return null;
    }
    return {
      message: parsed.message,
      requestId: typeof parsed.requestId === "string" ? parsed.requestId : undefined,
      kind: parsed.kind as PersistedAttestErrorKind | undefined,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveAttestError(
  wadId: string,
  err: { message: string; requestId?: string; kind?: PersistedAttestErrorKind }
): void {
  const s = storage();
  if (!s || !wadId) return;
  try {
    const payload: PersistedAttestError = {
      message: err.message,
      requestId: err.requestId,
      kind: err.kind,
      savedAt: Date.now(),
    };
    s.setItem(key(wadId), JSON.stringify(payload));
  } catch {
    /* quota or disabled storage - best-effort only */
  }
}

export function clearAttestError(wadId: string): void {
  const s = storage();
  if (!s || !wadId) return;
  try {
    s.removeItem(key(wadId));
  } catch {
    /* ignore */
  }
}
