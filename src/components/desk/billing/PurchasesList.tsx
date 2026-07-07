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
import { customerRefundLabel } from "@/lib/policy/refund-settlement";
import { CUSTOMER_REFUND_LABELS } from "@/lib/policy/dec-007-refund-policy";

interface PurchaseRow {
    id: string;
    package_id: string;
    token_amount: number;
    amount_usd: number;
    status: string;
    created_at: string;
    paystack_reference: string;
    // PayFast Phase 2A — provider-agnostic identity. Both nullable so
  // historical rows that pre-date the migration still render correctly.
  provider?: string | null;
    provider_reference?: string | null;
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
    // Batch Q — required to render the correct customer-facing label. A
  // refund with status='approved' may since have been provider-settled
  // or manually settled offline; the UI must not get stuck showing an
  // approval-only label forever once that happens.
  provider_settlement_status?: string | null;
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
                                </CardTitle>CardTitle>
                                <CardDescription>
                                            Recent credit purchases. You can request a refund on a completed
                                            purchase below - your request will be reviewed before any credits
                                            are adjusted. Approval is an internal decision and does not by
                                            itself confirm that funds have been returned by the payment
                                            provider.
                                </CardDescription>CardDescription>
                      </CardHeader>CardHeader>
                      <CardContent>
                        {!purchases || purchases.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                                    No purchases yet.
                      </p>p>
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
                                        // Batch Q — provider-neutral by default; only names a
                                        // specific provider (Paystack/PayFast) where the row
                                        // genuinely belongs to that provider.
                                        const providerName = p.provider === "payfast" ? "PayFast" : "Paystack";
                                        const resolvedLabel = resolved
                                                            ? customerRefundLabel(resolved.status, resolved.provider_settlement_status)
                                                            : null;
                                        const resolvedNeedsReview =
                                                            resolvedLabel === CUSTOMER_REFUND_LABELS.requiresAdminReview;
                                        const resolvedCompleted =
                                                            resolvedLabel === CUSTOMER_REFUND_LABELS.completed;
                                        const resolvedTooltipPrefix =
                                                            resolved?.status !== "approved"
                                                              ? ""
                                                              : resolvedCompleted
                                                              ? `Payment provider (${providerName}) confirmed that funds have been returned, or an admin recorded an authorised manual offline settlement. `
                                                              : resolvedNeedsReview
                                                              ? "A settlement mismatch was detected. This refund is under admin review - no funds or credits have moved automatically. "
                                                              : `Internal approval recorded. Awaiting payment provider (${providerName}) confirmation that funds have been returned. `;
                                        return (
                                                            <div
                                                                                  key={p.id}
                                                                                  data-testid={`billing-purchase-row-${p.id}`}
                                                                                  className="flex items-center justify-between py-2 border-b last:border-0 gap-3"
                                                                                >
                                                                                <div className="min-w-0">
                                                                                                      <p className="text-sm font-medium">
                                                                                                        {p.token_amount} credits
                                                                                                        {p.provider === "payfast" ? (
                                                                                                            <span className="text-muted-foreground"> · ZAR via PayFast</span>span>
                                                                                                          ) : (
                                                                                                            <span className="text-muted-foreground"> · ${Number(p.amount_usd).toFixed(2)} USD via Paystack</span>span>
                                                                                                                              )}
                                                                                                        </p>p>
                                                                                                      <p className="text-xs text-muted-foreground">
                                                                                                        {new Date(p.created_at).toLocaleString()} · Ref{" "}
                                                                                                                              <code
                                                                                                                                                          className="font-mono text-xs"
                                                                                                                                                          data-testid={`billing-purchase-ref-${p.id}`}
                                                                                                                                                          title={
                                                                                                                                                                                        p.provider === "payfast"
                                                                                                                                                                                          ? "Payment provider: payfast"
                                                                                                                                                                                          : "Payment provider: paystack"
                                                                                                                                                            }
                                                                                                                                                        >
                                                                                                                                {p.provider === "payfast"
                                                                                                                                                              ? (p.provider_reference ?? p.paystack_reference)
                                                                                                                                                              : p.paystack_reference}
                                                                                                                                </code>code>
                                                                                                        </p>p>
                                                                                  </div>div>
                                                                                <div className="flex items-center gap-2 shrink-0">
                                                                                                      <Badge
                                                                                                                                variant="outline"
                                                                                                                                data-testid={`billing-purchase-provider-${p.id}`}
                                                                                                                                className={
                                                                                                                                                            p.provider === "payfast"
                                                                                                                                                              ? "border-blue-300 text-blue-700"
                                                                                                                                                              : "border-emerald-300 text-emerald-700"
                                                                                                                                  }
                                                                                                                              >
                                                                                                        {p.provider === "payfast" ? "PayFast" : "Paystack"}
                                                                                                        </Badge>Badge>
                                                                                                      <Badge variant={p.status === "completed" ? "secondary" : "outline"}>
                                                                                                        {p.status}
                                                                                                        </Badge>Badge>
                                                                                  {hasPending ? (
                                                                                                          <Badge
                                                                                                                                      variant="outline"
                                                                                                                                      data-testid={`refund-pending-${p.id}`}
                                                                                                                                    >
                                                                                                                                    Refund request pending
                                                                                                            </Badge>Badge>
                                                                                                        ) : blockedLabel ? (
                                                                                                          <Badge
                                                                                                                                      variant="outline"
                                                                                                                                      className="text-muted-foreground"
                                                                                                                                      data-testid={`refund-blocked-${p.id}`}
                                                                                                                                      title={blockedLabel}
                                                                                                                                    >
                                                                                                            {blockedLabel}
                                                                                                            </Badge>Badge>
                                                                                                        ) : resolvedLabel ? (
                                                                                                          <Badge
                                                                                                                                      variant="outline"
                                                                                                                                      className={
                                                                                                                                                                    resolvedNeedsReview
                                                                                                                                                                      ? "border-amber-300 text-amber-700"
                                                                                                                                                                      : "text-muted-foreground"
                                                                                                                                        }
                                                                                                                                      data-testid={`refund-resolved-${p.id}`}
                                                                                                                                      title={
                                                                                                                                                                    resolved?.decision_reason
                                                                                                                                                                      ? `${resolvedTooltipPrefix}${resolvedLabel} - ${resolved.decision_reason}`
                                                                                                                                                                      : `${resolvedTooltipPrefix}${resolvedLabel}`
                                                                                                                                        }
                                                                                                                                    >
                                                                                                            {resolvedLabel}
                                                                                                            </Badge>Badge>
                                                                                                        ) : eligible ? (
                                                                                                          <Button
                                                                                                                                      variant="outline"
                                                                                                                                      size="sm"
                                                                                                                                      onClick={() => setActivePurchase(p)}
                                                                                                                                      data-testid={`refund-request-button-${p.id}`}
                                                                                                                                    >
                                                                                                                                    Request refund
                                                                                                            </Button>Button>
                                                                                                        ) : null}
                                                                                  </div>div>
                                                            </div>div>
                                                          );
                      })}
                      </div>div>
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
                      </p>p>
                                )}
                      </CardContent>CardContent>
              </Card>Card>
        
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
        </>>
      );
}</>
