/**
 * usePayfastPublicAvailability — customer-facing PayFast probe.
 *
 * Calls the `payfast-checkout-public` GET probe to decide whether the
 * customer-facing PayFast option should be rendered, and to read the
 * current admin-managed USD/ZAR rate for inline display. The probe
 * returns only boolean flags + the resolved global mode + the rate —
 * never secrets.
 *
 * The customer button must be HIDDEN whenever the probe is not
 * available (gate off, wrong mode, merchant creds missing, URLs
 * missing, or FX rate unset), so PayFast can be turned off instantly
 * by flipping the `PAYFAST_PUBLIC_ENABLED` env flag or unsetting the
 * rate.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface PayfastPublicProbe {
  ok: boolean;
  available: boolean;
  publicEnabled: boolean;
  globalMode: "sandbox" | "live";
  merchantConfigured: boolean;
  urlsConfigured: boolean;
  fxRateConfigured: boolean;
  usdZarRate: number | null;
}

export interface UsePayfastPublicAvailabilityResult {
  loading: boolean;
  probe: PayfastPublicProbe | null;
  available: boolean;
  usdZarRate: number | null;
}

export function usePayfastPublicAvailability(): UsePayfastPublicAvailabilityResult {
  const { session } = useAuth();
  const [probe, setProbe] = useState<PayfastPublicProbe | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    if (!session?.access_token) {
      setProbe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "payfast-checkout-public",
          {
            method: "GET",
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );
        if (cancelled) return;
        if (error) {
          setProbe(null);
        } else {
          setProbe((data ?? null) as PayfastPublicProbe | null);
        }
      } catch {
        if (!cancelled) setProbe(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session?.access_token]);

  return {
    loading,
    probe,
    available: probe?.available === true,
    usdZarRate: probe?.usdZarRate ?? null,
  };
}
