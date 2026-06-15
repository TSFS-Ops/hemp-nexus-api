/**
 * DEC-007 - Org-side purchases list with Request refund affordance.
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

interface BlockedRefundRow {
  token_purchase_id: string;
  status: "blocked_credits_used" | "blocked_expired" | string;
  created_at: string;
}

interface ResolvedRefundRow {
  id: string;
  token_purchase_id: string;
  status: "approved" | "declined" | "superseded" | string;
  reviewed_at: string | null;
  decision_reason: string | null;
  created_at: string;
}

interface ListOrgPurchasesResponse {
  success: boolean;
  purchases: (PurchaseRow & { out_of_page?: boolean })[];
  pending_refunds: PendingRefundRow[];
  blocked_refunds?: BlockedRefundRow[];
  resolved_refunds?: ResolvedRefundRow[];
  pagination?: {
    limit: number;
    offset: number;
    total_count: number;
    has_more: boolean;
  };
}

interface PurchasesListProps {
  orgId: string | undefined;
}

export function PurchasesList({ orgId }: PurchasesListProps) {
  const queryClient = useQueryClient();
  const [activePurchase, setActivePurchase] = useState<PurchaseRow | null>(null);

  const { data } = useQuery({
    queryKey: ["billing-org-purchases", orgId],
    queryFn: async (): Promise<ListOrgPurchasesResponse> => {
      const { data, error } = await supabase.functions.invoke("list-org-purchases", {
        body: {},
      });
      if (error) throw error;
      return data as ListOrgPurchasesResponse;
    },
    enabled: !!orgId,
  });

  const purchases = data?.purchases ?? [];
  const pendingRefunds = data?.pending_refunds ?? [];
  const blockedRefunds = data?.blocked_refunds ?? [];
  const resolvedRefunds = data?.resolved_refunds ?? [];
  const pagination = data?.pagination;

  const pendingSet = new Set(pendingRefunds.map((r) => r.token_purchase_id));
  const blockedMap = new Map(blockedRefunds.map((r) => [r.token_purchase_id, r.status]));
  // Latest resolved outcome per purchase (rows are newest-first from server).
  const resolvedMap = new Map<string, ResolvedRefundRow>();
  for (const r of resolvedRefunds) {
    if (!resolvedMap.has(r.token_purchase_id)) resolvedMap.set(r.token_purchase_id, r);
  }

  const onRefundSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["billing-org-purchases", orgId] });
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
            purchase below - your request will be reviewed before any credits
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
                const blockedStatus = blockedMap.get(p.id);
                const blockedLabel =
                  blockedStatus === "blocked_credits_used"
                    ? "Refund unavailable - credits already used"
                    : blockedStatus === "blocked_expired"
                      ? "Refund unavailable - outside window"
                      : null;
                const resolved = !hasPending ? resolvedMap.get(p.id) : undefined;
                const resolvedLabel =
                  resolved?.status === "approved"
                    ? "Refund approved"
                    : resolved?.status === "declined"
                      ? "Refund declined"
                      : resolved?.status === "superseded"
                        ? "Refund superseded"
                        : null;
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
                      ) : blockedLabel ? (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                          data-testid={`refund-blocked-${p.id}`}
                          title={blockedLabel}
                        >
                          {blockedLabel}
                        </Badge>
                      ) : resolvedLabel ? (
                        <Badge
                          variant="outline"
                          className="text-muted-foreground"
                          data-testid={`refund-resolved-${p.id}`}
                          title={
                            resolved?.decision_reason
                              ? `${resolvedLabel} - ${resolved.decision_reason}`
                              : resolvedLabel
                          }
                        >
                          {resolvedLabel}
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
          {pagination && pagination.has_more && (
            <p
              className="mt-3 text-xs text-muted-foreground"
              data-testid="billing-purchases-truncated-notice"
            >
              Showing the {pagination.limit} most recent of{" "}
              {pagination.total_count} purchases. Older rows are not shown
              here, but any purchase with an open or blocked refund request is
              always included above.
            </p>
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
