/**
 * usePayfastConnectivity — calls the `payfast-connectivity-probe` edge
 * function to determine whether PayFast's customer-facing hosts are
 * actually reachable from the server right now.
 *
 * Used by the checkout UI to render a friendly "provider temporarily
 * unavailable" state instead of redirecting the customer into a
 * `payment.payfast.io refused to connect` browser error.
 *
 * The probe is server-side only — the browser cannot reach those
 * hosts cross-origin without opaque responses.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PayfastConnectivityStatus = "ok" | "degraded" | "unavailable";

export interface PayfastHostProbe {
  host: string;
  url: string;
  ok: boolean;
  status: number | null;
  durationMs: number;
  error: string | null;
}

export interface PayfastConnectivityResult {
  ok: boolean;
  checkedAt: string;
  status: PayfastConnectivityStatus;
  reachable: boolean;
  probes: PayfastHostProbe[];
}

export interface UsePayfastConnectivity {
  loading: boolean;
  result: PayfastConnectivityResult | null;
  /** True when the probe is OK. While loading or unknown, defaults to true so we don't block the button on first paint. */
  reachable: boolean;
  status: PayfastConnectivityStatus | "unknown";
  /** The card-capture host (`payment.payfast.io`) status only — that's the user-visible failure surface. */
  cardCaptureReachable: boolean;
  refresh: () => Promise<void>;
}

export function usePayfastConnectivity(autoRun = true): UsePayfastConnectivity {
  const [result, setResult] = useState<PayfastConnectivityResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "payfast-connectivity-probe",
        { method: "GET" },
      );
      if (error) {
        setResult(null);
        return;
      }
      setResult((data ?? null) as PayfastConnectivityResult | null);
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoRun) void run();
  }, [autoRun, run]);

  const cardCapture = result?.probes.find((p) => p.host === "payment.payfast.io");

  return {
    loading,
    result,
    // Default to reachable=true while loading / unknown so we don't
    // suppress the button on first paint before the probe returns.
    reachable: result ? result.reachable : true,
    status: result ? result.status : "unknown",
    cardCaptureReachable: cardCapture ? cardCapture.ok : true,
    refresh: run,
  };
}
