/**
 * PayfastReturn — Phase 2J customer-facing return page.
 *
 * Honest progress page after PayFast redirects the customer back. This
 * page NEVER credits the wallet — credit is issued ONLY by the verified
 * ITN handler (`payfast-itn`). It just polls `token_purchases` by
 * `provider_reference` and tells the customer where their purchase is.
 */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

type Status = "pending" | "completed" | "failed" | "cancelled" | "abandoned" | "unknown";

interface PurchaseRow {
  id: string;
  status: string;
  token_amount: number | null;
  provider: string | null;
  provider_reference: string | null;
}

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_MS = 60_000;

export default function PayfastReturn() {
  const [params] = useSearchParams();
  // PayFast posts the original m_payment_id back on its return GET.
  const providerRef =
    params.get("m_payment_id") || params.get("provider_reference") || params.get("reference") || "";

  const [row, setRow] = useState<PurchaseRow | null>(null);
  const [status, setStatus] = useState<Status>("pending");
  const [polling, setPolling] = useState<boolean>(true);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!providerRef) {
      setPolling(false);
      setStatus("unknown");
      return;
    }
    const start = Date.now();
    let cancelled = false;

    const tick = async () => {
      const { data } = await supabase
        .from("token_purchases")
        .select("id, status, token_amount, provider, provider_reference")
        .eq("provider", "payfast")
        .eq("provider_reference", providerRef)
        .maybeSingle();
      if (cancelled) return;

      if (data) {
        setRow(data as PurchaseRow);
        const s = (data.status as Status) ?? "pending";
        setStatus(s);

        if (s === "completed") {
          // Read the wallet to show the post-credit balance. We do NOT
          // credit here — `payfast-itn` is the only credit path.
          const { data: profile } = await supabase
            .from("profiles")
            .select("org_id")
            .maybeSingle();
          if (profile?.org_id) {
            const { data: wallet } = await supabase
              .from("token_balances")
              .select("balance")
              .eq("org_id", profile.org_id)
              .maybeSingle();
            if (!cancelled) setBalance(Number(wallet?.balance ?? 0));
          }
          setPolling(false);
          return;
        }
        if (s === "failed" || s === "cancelled" || s === "abandoned") {
          setPolling(false);
          return;
        }
      }

      if (Date.now() - start >= POLL_MAX_MS) {
        setPolling(false);
        return;
      }
      setTimeout(() => { if (!cancelled) void tick(); }, POLL_INTERVAL_MS);
    };

    void tick();
    return () => { cancelled = true; };
  }, [providerRef]);

  return (
    <div className="max-w-xl mx-auto py-16 px-4">
      <Card data-testid="payfast-return-card">
        <CardHeader>
          <CardTitle>PayFast payment</CardTitle>
          <CardDescription>
            Your wallet is credited only after PayFast confirms the payment
            with Izenzo (verified ITN). This page reflects the live status
            of your purchase — it does not credit your wallet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!providerRef && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="payfast-return-missing-ref"
            >
              No payment reference was provided. If you completed a payment,
              please return to <Link to="/desk/billing" className="underline">Billing</Link> — the
              ITN will credit your wallet shortly.
            </p>
          )}

          {providerRef && polling && status === "pending" && (
            <div
              className="flex items-center gap-3 text-sm"
              data-testid="payfast-return-pending"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Confirming payment with PayFast…</span>
            </div>
          )}

          {status === "completed" && (
            <div
              className="space-y-2 text-sm"
              data-testid="payfast-return-completed"
            >
              <p className="font-medium text-foreground">
                Credits applied to your wallet.
              </p>
              {row?.token_amount != null && (
                <p className="text-muted-foreground">
                  +{row.token_amount} credit{row.token_amount === 1 ? "" : "s"}.
                </p>
              )}
              {balance != null && (
                <p className="text-muted-foreground">
                  New balance: <span className="font-mono">{balance.toLocaleString()}</span> credits.
                </p>
              )}
            </div>
          )}

          {(status === "failed" || status === "cancelled" || status === "abandoned") && (
            <div
              className="space-y-2 text-sm"
              data-testid="payfast-return-not-successful"
            >
              <p className="font-medium text-foreground">
                Payment was not successful.
              </p>
              <p className="text-muted-foreground">
                No credits were issued. You can try again from the billing page.
              </p>
            </div>
          )}

          {providerRef && !polling && status === "pending" && (
            <div
              className="space-y-2 text-sm"
              data-testid="payfast-return-still-pending"
            >
              <p className="font-medium text-foreground">
                Still awaiting confirmation from PayFast.
              </p>
              <p className="text-muted-foreground">
                Your wallet will be credited once Izenzo receives the verified
                ITN from PayFast. You can safely close this page; the credit
                will appear automatically.
              </p>
            </div>
          )}

          {providerRef && (
            <p
              className="font-mono text-[10px] tracking-wide text-muted-foreground/70"
              data-testid="payfast-return-reference"
            >
              Reference: {providerRef}
            </p>
          )}

          <div className="pt-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/desk/billing">Back to Billing</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
