/**
 * usePayfastPublicAvailability — Phase 2J.
 *
 * Calls the `payfast-checkout-public` GET probe to decide whether the
 * customer-facing PayFast option should be rendered. The probe returns
 * only boolean flags and the resolved global mode — never secrets.
 *
 * The customer button must be HIDDEN whenever the probe is not
 * available, so PayFast can be turned off instantly by flipping the
 * `PAYFAST_PUBLIC_ENABLED` env flag without a deploy.
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
}

export interface UsePayfastPublicAvailabilityResult {
  loading: boolean;
  probe: PayfastPublicProbe | null;
  available: boolean;
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
  };
}
