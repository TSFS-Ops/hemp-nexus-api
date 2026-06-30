/**
 * payfast-checkout-logger — frontend structured logger for the
 * customer PayFast checkout redirect flow.
 *
 * Every checkout attempt gets a single `requestId` that correlates
 * every phase (initiate → edge response → form submit → retry /
 * dismiss / visibility return / error). Each phase is emitted as one
 * structured `console.info` (or `console.error`) line and appended to
 * a bounded sessionStorage trail so support can copy the timeline if
 * a user reports `payment.payfast.io refused to connect`.
 *
 * No PII, no card data, no signed-field values — only metadata.
 */
import type { PayfastCustomerPackageId } from "@/lib/credit-checkout-payfast";

export type PayfastLogPhase =
  | "initiate_start"
  | "edge_response_ok"
  | "edge_response_error"
  | "form_submit"
  | "form_submit_error"
  | "retry_clicked"
  | "dismiss_clicked"
  | "tab_visibility_returned"
  | "checkout_error";

export interface PayfastLogEntry {
  ts: string;
  requestId: string;
  phase: PayfastLogPhase;
  packageId: PayfastCustomerPackageId;
  /** Monotonic ms since logger creation — useful for "how long until refused". */
  elapsedMs: number;
  /** Whether the app is running inside a (preview) iframe. */
  inIframe: boolean;
  /** Origin the customer is on. */
  origin: string;
  /** Optional fields filled per-phase. */
  purchaseId?: string;
  providerReference?: string;
  checkoutHost?: string;
  amountZar?: number;
  amountUsd?: number;
  usdZarRate?: number;
  credits?: number;
  formFieldCount?: number;
  errorMessage?: string;
  errorName?: string;
  /** Free-form structured detail (small, primitive values only). */
  extra?: Record<string, string | number | boolean | null>;
}

const STORAGE_KEY = "payfast.checkout.trail.v1";
const TRAIL_MAX = 50;

function safeRandomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return (crypto as Crypto).randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `pf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function appendToTrail(entry: PayfastLogEntry): void {
  try {
    if (typeof sessionStorage === "undefined") return;
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const arr: PayfastLogEntry[] = raw ? JSON.parse(raw) : [];
    arr.push(entry);
    while (arr.length > TRAIL_MAX) arr.shift();
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch {
    /* sessionStorage unavailable or quota exceeded — ignore */
  }
}

export interface PayfastLogger {
  readonly requestId: string;
  log(
    phase: PayfastLogPhase,
    fields?: Partial<Omit<PayfastLogEntry, "ts" | "requestId" | "phase" | "packageId" | "elapsedMs" | "inIframe" | "origin">>,
  ): PayfastLogEntry;
}

export function createPayfastLogger(
  packageId: PayfastCustomerPackageId,
  requestIdOverride?: string,
): PayfastLogger {
  const requestId = requestIdOverride ?? safeRandomId();
  const startedAt =
    typeof performance !== "undefined" && "now" in performance
      ? performance.now()
      : Date.now();
  const inIframe = typeof window !== "undefined" && window.self !== window.top;
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return {
    requestId,
    log(phase, fields = {}) {
      const now =
        typeof performance !== "undefined" && "now" in performance
          ? performance.now()
          : Date.now();
      const entry: PayfastLogEntry = {
        ts: new Date().toISOString(),
        requestId,
        phase,
        packageId,
        elapsedMs: Math.round(now - startedAt),
        inIframe,
        origin,
        ...fields,
      };

      const isError =
        phase === "edge_response_error"
        || phase === "form_submit_error"
        || phase === "checkout_error";

      // Single-line structured emission — tag makes it greppable.
      const tag = "[payfast.checkout]";
      if (isError) {
        // eslint-disable-next-line no-console
        console.error(tag, entry);
      } else {
        // eslint-disable-next-line no-console
        console.info(tag, entry);
      }

      appendToTrail(entry);
      return entry;
    },
  };
}

/** Read the bounded session trail — used by support / diagnostic UI. */
export function readPayfastTrail(): PayfastLogEntry[] {
  try {
    if (typeof sessionStorage === "undefined") return [];
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PayfastLogEntry[]) : [];
  } catch {
    return [];
  }
}

export function clearPayfastTrail(): void {
  try {
    sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
