/**
 * DEC-007 — Org-side purchases list with Request refund affordance.
 *
 * Lists completed token_purchases for the caller's org and exposes a
 * "Request refund" button per eligible row. Eligibility is intentionally
 * permissive at the UI layer (status='completed' and no pending
 * refund_request). The authoritative classification (within-window,
 * already-burned, expired) is performed server-side by the
 * `request_refund` RPC.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Receipt } from "lucide-react";
import { RefundRequestDialog } from "./RefundRequestDialog";

interface PurchaseRow {
  id: string;
  package_id: string;
  token_amount: number;
  amount_usd: number;
  status: string;
  created_at: string;
  paystack_reference: string;
}

interface PendingRefundRow {
  token_purchase_id: string;
  status: string;
}

interface PurchasesListProps {
  orgId: string | undefined;
}

export function PurchasesList({ orgId }: PurchasesListProps) {
  const queryClient = useQueryClient();
  const [activePurchase, setActivePurchase] = useState<PurchaseRow | null>(null);

  const { data: purchases } = useQuery({
    queryKey: ["billing-purchases", orgId],
    queryFn: async (): Promise<PurchaseRow[]> => {
      const { data, error } = await supabase
        .from("token_purchases")
        .select("id, package_id, token_amount, amount_usd, status, created_at, paystack_reference")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as PurchaseRow[];
    },
    enabled: !!orgId,
  });

  const { data: pendingRefunds } = useQuery({
    queryKey: ["billing-pending-refunds", orgId],
    queryFn: async (): Promise<PendingRefundRow[]> => {
      const { data, error } = await supabase
        .from("refund_requests")
        .select("token_purchase_id, status")
        .eq("org_id", orgId!)
        .eq("status", "pending");
      if (error) throw error;
      return (data ?? []) as PendingRefundRow[];
    },
    enabled: !!orgId,
  });

  const pendingSet = new Set((pendingRefunds ?? []).map((r) => r.token_purchase_id));

  const onRefundSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["billing-pending-refunds", orgId] });
  };

  return (
    <>
      <Card data-testid="billing-purchases-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Your Purchases
          </CardTitle>
          <CardDescription>
            Recent credit purchases. You can request a refund on a completed
            purchase below — your request will be reviewed before any credits
            are adjusted.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!purchases || purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No purchases yet.
            </p>
          ) : (
            <div className="space-y-2">
              {purchases.map((p) => {
                const eligible = p.status === "completed";
                const hasPending = pendingSet.has(p.id);
                return (
                  <div
                    key={p.id}
                    data-testid={`billing-purchase-row-${p.id}`}
                    className="flex items-center justify-between py-2 border-b last:border-0 gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {p.token_amount} credits · ${Number(p.amount_usd).toFixed(2)} USD
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleString()} · Ref{" "}
                        <code className="font-mono text-xs">{p.paystack_reference}</code>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant={p.status === "completed" ? "secondary" : "outline"}>
                        {p.status}
                      </Badge>
                      {hasPending ? (
                        <Badge
                          variant="outline"
                          data-testid={`refund-pending-${p.id}`}
                        >
                          Refund request pending
                        </Badge>
                      ) : eligible ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setActivePurchase(p)}
                          data-testid={`refund-request-button-${p.id}`}
                        >
                          Request refund
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {activePurchase && (
        <RefundRequestDialog
          open={!!activePurchase}
          onOpenChange={(o) => {
            if (!o) setActivePurchase(null);
          }}
          tokenPurchaseId={activePurchase.id}
          purchaseLabel={`${activePurchase.token_amount} credits · $${Number(
            activePurchase.amount_usd,
          ).toFixed(2)} USD`}
          onSuccess={onRefundSuccess}
        />
      )}
    </>
  );
}
