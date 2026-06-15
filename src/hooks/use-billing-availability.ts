/**
 * use-billing-availability - small read-only hook that returns the
 * platform's current credit-purchase availability.
 *
 * Reads from the `get_billing_availability()` RPC, which returns the
 * `billing_availability` row from `admin_settings`. The flag is used
 * by every credit-purchase entry point to:
 *
 *   - hide / disable the "Buy" / "Purchase" / "Top Up" / "Proceed to
 *     Payment" CTA when `enabled === false`
 *   - render a reversible "Credit purchases temporarily unavailable"
 *     notice that explains why and links to support
 *
 * This is intentionally a thin, dependency-free hook (no React Query)
 * so it can be safely mounted on the public Pricing page (anon role)
 * as well as inside the authenticated desk shell. The RPC is granted
 * to both `anon` and `authenticated` and only exposes the single
 * non-sensitive availability blob.
 *
 * Default behaviour while loading or on error is **disabled** - we
 * fail-closed so a transient backend hiccup never silently re-enables
 * checkout while Paystack USD settlement is pending.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface BillingAvailability {
  enabled: boolean;
  reason: string | null;
  message: string | null;
}

const DEFAULT_DISABLED: BillingAvailability = {
  enabled: false,
  reason: "loading",
  message:
    "Credit purchases are temporarily unavailable while USD settlement is being enabled.",
};

export function useBillingAvailability(): {
  availability: BillingAvailability;
  loading: boolean;
} {
  const [availability, setAvailability] =
    useState<BillingAvailability>(DEFAULT_DISABLED);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_billing_availability");
        if (cancelled) return;
        if (error || !data || typeof data !== "object") {
          // Fail-closed: keep DEFAULT_DISABLED so checkout stays hidden
          // until we can confirm availability.
          setLoading(false);
          return;
        }
        const blob = data as Record<string, unknown>;
        setAvailability({
          enabled: blob.enabled === true,
          reason: typeof blob.reason === "string" ? blob.reason : null,
          message: typeof blob.message === "string" ? blob.message : null,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { availability, loading };
}
