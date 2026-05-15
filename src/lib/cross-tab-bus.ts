/**
 * UI-007 — Cross-tab cache bridge.
 *
 * When the user has multiple tabs open, mutations in one tab must invalidate
 * relevant React Query caches in the others. We use BroadcastChannel where
 * available and fall back to `localStorage` + the `storage` event for older
 * browsers (Safari ≤ 15.4 in particular).
 *
 * Channel name: `izenzo-cache` (also used as the localStorage key prefix).
 *
 * Mount the consumer hook ONCE near the app root (see App.tsx). Publishers
 * call `publish(event)` from mutation success branches — never from passive
 * reads.
 */

import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { invalidateAllCreditBalanceQueries } from "@/lib/credit-balance-invalidation";

export const CROSS_TAB_CHANNEL_NAME = "izenzo-cache";
const STORAGE_KEY = "izenzo-cache:event";

export type CrossTabEvent =
  | { kind: "credit-balance" }
  | { kind: "match"; matchId: string }
  | { kind: "engagement-status"; matchId: string };

interface Envelope {
  /** Random token so identical events still trigger storage listeners. */
  nonce: string;
  /** ISO timestamp; consumers may ignore stale events if needed. */
  ts: string;
  event: CrossTabEvent;
}

function makeEnvelope(event: CrossTabEvent): Envelope {
  return {
    nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    ts: new Date().toISOString(),
    event,
  };
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
  } catch {
    return null;
  }
}

/**
 * Publish a cross-tab cache-invalidation event. Best-effort: failures
 * (e.g. BroadcastChannel unavailable, localStorage quota) are swallowed
 * because cache invalidation is never critical-path.
 */
export function publish(event: CrossTabEvent): void {
  const envelope = makeEnvelope(event);

  // 1. BroadcastChannel — modern path.
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(envelope);
    } catch {
      // ignore
    } finally {
      try { ch.close(); } catch { /* ignore */ }
    }
  }

  // 2. localStorage fallback — fires `storage` events in OTHER tabs only.
  if (typeof window !== "undefined" && typeof window.localStorage !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
    } catch {
      // ignore (private mode, quota, etc.)
    }
  }
}

function applyEvent(queryClient: QueryClient, event: CrossTabEvent): void {
  switch (event.kind) {
    case "credit-balance":
      invalidateAllCreditBalanceQueries(queryClient);
      return;
    case "match":
      queryClient.invalidateQueries({ queryKey: ["match", event.matchId] });
      return;
    case "engagement-status":
      queryClient.invalidateQueries({ queryKey: ["engagement-status-gate", event.matchId] });
      return;
  }
}

function parseEnvelope(raw: unknown): CrossTabEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const env = raw as Partial<Envelope>;
  if (!env.event || typeof env.event !== "object") return null;
  const ev = env.event as { kind?: string; matchId?: string };
  if (ev.kind === "credit-balance") return { kind: "credit-balance" };
  if ((ev.kind === "match" || ev.kind === "engagement-status") && typeof ev.matchId === "string") {
    return { kind: ev.kind, matchId: ev.matchId };
  }
  return null;
}

/**
 * Subscribe the current tab to cross-tab cache events. Mount once at the
 * app root inside the QueryClientProvider tree.
 */
export function useCrossTabInvalidate(queryClient: QueryClient): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let bc: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        bc = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
        bc.onmessage = (msg) => {
          const event = parseEnvelope(msg.data);
          if (event) applyEvent(queryClient, event);
        };
      } catch {
        bc = null;
      }
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const parsed = JSON.parse(e.newValue) as unknown;
        const event = parseEnvelope(parsed);
        if (event) applyEvent(queryClient, event);
      } catch {
        // ignore malformed payload
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("storage", onStorage);
      if (bc) {
        try { bc.close(); } catch { /* ignore */ }
      }
    };
  }, [queryClient]);
}

/**
 * Tiny mount-only component so App.tsx can subscribe without converting
 * to a hook-bearing function component just for this side-effect.
 */
export function CrossTabCacheBridge({ queryClient }: { queryClient: QueryClient }) {
  useCrossTabInvalidate(queryClient);
  return null;
}
