/**
 * PayfastLiveSmokeTestButton — Phase 2G live readiness.
 *
 * Admin-only LIVE smoke-test button. Hidden from all normal customers.
 * Renders only when:
 *   • viewer has the `platform_admin` role, AND
 *   • the `payfast-checkout-live` availability probe reports
 *     `available === true` (which requires PAYFAST_MODE=live AND
 *     PAYFAST_LIVE_SMOKE_ENABLED=true AND live merchant secrets +
 *     URLs configured on the server).
 *
 * Server is the real authority — this component's gates are belt &
 * braces only. The server returns structured rejections if any gate
 * fails, which we surface as a toast (no live money moves on reject).
 *
 * This component is DISTINCT from the sandbox button by design so an
 * admin cannot accidentally fire live with sandbox creds.
 *
 * Paystack is the unchanged customer-facing path. No customer ever
 * sees this button.
 */
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface ProbeResult {
  ok: boolean;
  available: boolean;
  smokeEnabled: boolean;
  globalMode: "sandbox" | "live";
  merchantConfigured: boolean;
  urlsConfigured: boolean;
}

export function PayfastLiveSmokeTestButton() {
  const { session, isAdmin } = useAuth();
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!isAdmin || !session?.access_token) return;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "payfast-checkout-live",
          {
            method: "GET",
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );
        if (cancelled) return;
        if (error) {
          setProbe(null);
          return;
        }
        setProbe(data as ProbeResult);
      } catch {
        if (!cancelled) setProbe(null);
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin, session?.access_token]);

  // Hard client gates. Server still authoritative.
  if (!isAdmin) return null;
  if (!probe || probe.available !== true) return null;

  const handleClick = async () => {
    if (!session?.access_token) {
      toast.error("Sign in required");
      return;
    }
    const confirmed = window.confirm(
      "⚠ LIVE PayFast payment\n\n" +
      "This will charge a real amount via PayFast LIVE.\n\n" +
      "Proceed?",
    );
    if (!confirmed) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "payfast-checkout-live",
        {
          body: { provider: "payfast", mode: "live", packageId: "live_smoke" },
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (error) throw error;
      const payload = data as {
        ok?: boolean;
        reason?: string;
        detail?: string;
        error?: string;
        checkoutUrl?: string;
        formFields?: Array<{ name: string; value: string }>;
      };
      if (!payload?.ok || !payload.checkoutUrl || !Array.isArray(payload.formFields)) {
        const msg =
          payload?.detail ?? payload?.reason ?? payload?.error ?? "unknown";
        toast.error(`Live smoke rejected: ${msg}`);
        return;
      }
      const url = new URL(payload.checkoutUrl);
      const form = document.createElement("form");
      form.method = "POST";
      form.action = `${url.origin}${url.pathname}`;
      form.target = "_blank";
      for (const { name, value } of payload.formFields) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
      form.remove();
      toast.success("PayFast LIVE checkout opened in a new tab");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Live payment failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-red-400 bg-red-50/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <CardTitle className="text-lg text-red-700">
            PayFast Live Payment (Admin Only — REAL MONEY)
          </CardTitle>
        </div>
        <CardDescription>
          Live PayFast payment path. Charges a real amount. Admin-only
          while PayFast is not exposed to normal customers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            This calls the admin-gated <code>payfast-checkout-live</code>{" "}
            edge function. Live money will move. Paystack is unaffected.
          </AlertDescription>
        </Alert>
        <Button
          variant="destructive"
          onClick={handleClick}
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Opening live checkout…
            </>
          ) : (
            "Start PayFast Live Payment"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
