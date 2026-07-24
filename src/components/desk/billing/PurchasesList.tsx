/**
 * DEC-007 - Org-side purchases list with Request refund affordance.
 *
 * Lists completed token_purchases for the caller's org and exposes a
 * "Request refund" button per eligible row. Eligibility is intentionally
 * permissive at the UI layer (status='completed' and no pending
 * refund_request). The authoritative classification (within-window,
 * already-burned, expired) is performed server-side by the
 * `request_refund` RPC.
 *
 * Trust boundary
 * --------------
 * PayFast is the only payment provider normal customers should see.
 * Legacy rows may still carry a Paystack provider/reference from before
 * the PayFast migration. Non-admin viewers never see the literal word
 * "Paystack", a raw paystack_reference value, or customer-facing
 * "settlement" wording -- legacy rows are shown with neutral "card
 * checkout" wording and a masked payment reference instead. Platform
 * admins retain full internal visibility (raw reference, provider name,
 * and settlement-status wording), clearly marked with
 * `data-admin-only="true"`.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
  // PayFast Phase 2A -- provider-agnostic identity. Both nullable so
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

// Non-admin customers never see a raw legacy paystack_reference value.
// Only the last 4 characters are shown, prefixed with a masked marker.
function maskPaymentReference(ref: string | null | undefined): string {
  if (!ref) return "••••";
  const tail = ref.length > 4 ? ref.slice(-4) : ref;
  return "••••" + tail;
}

export function PurchasesList({ orgId }: PurchasesListProps) {
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
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
            are adjusted. Approval is an internal decision and does not by
            itself confirm that funds have been returned by the payment
            provider.
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
                const isLegacyPaystack = p.provider !== "payfast";
                const resolvedLabel =
                  resolved?.status === "approved"
                    ? isAdmin
                      ? "Refund approved - provider settlement pending"
                      : "Refund approved"
                    : resolved?.status === "declined"
                    ? "Refund declined"
                    : resolved?.status === "superseded"
                    ? "Refund superseded"
                    : null;
                const resolvedTooltip = (() => {
                  if (!resolved) return undefined;
                  if (resolved.status === "approved" && !isAdmin) {
                    return "Your refund has been approved. Funds are returned by the original payment method and may take several business days to appear.";
                  }
                  const prefix =
                    resolved.status === "approved" && isAdmin
                      ? "Internal approval recorded. Awaiting payment-provider (Paystack) confirmation that funds have been returned. "
                      : "";
                  return resolved.decision_reason
                    ? prefix + resolvedLabel + " - " + resolved.decision_reason
                    : prefix + resolvedLabel;
                })();
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
                          <span className="text-muted-foreground">
                            {" "}· ${Number(p.amount_usd).toFixed(2)} USD via PayFast
                          </span>
                        ) : isAdmin ? (
                          <span
                            className="text-muted-foreground"
                            data-admin-only="true"
                            title="Admin-only / internal -- not visible to customers"
                          >
                            {" "}· ${Number(p.amount_usd).toFixed(2)} USD via Paystack (legacy/internal)
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            {" "}· ${Number(p.amount_usd).toFixed(2)} USD via card checkout
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.created_at).toLocaleString()} · Ref{" "}
                        <code
                          className="font-mono text-xs"
                          data-testid={`billing-purchase-ref-${p.id}`}
                          data-admin-only={isLegacyPaystack && isAdmin ? "true" : undefined}
                          title={
                            p.provider === "payfast"
                              ? "Payment reference"
                              : isAdmin
                              ? "Payment provider: paystack (legacy/internal)"
                              : "Payment reference"
                          }
                        >
                          {p.provider === "payfast"
                            ? (p.provider_reference ?? p.paystack_reference)
                            : isAdmin
                            ? p.paystack_reference
                            : maskPaymentReference(p.paystack_reference)}
                        </code>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge
                        variant="outline"
                        data-testid={`billing-purchase-provider-${p.id}`}
                        data-admin-only={isLegacyPaystack && isAdmin ? "true" : undefined}
                        title={
                          isLegacyPaystack && isAdmin
                            ? "Admin-only / internal -- not visible to customers"
                            : undefined
                        }
                        className={
                          p.provider === "payfast"
                            ? "border-blue-300 text-blue-700"
                            : isAdmin
                            ? "border-emerald-300 text-emerald-700"
                            : "border-gray-300 text-gray-700"
                        }
                      >
                        {p.provider === "payfast"
                          ? "PayFast"
                          : isAdmin
                          ? "Paystack · legacy/internal"
                          : "Card"}
                      </Badge>
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
                          title={resolvedTooltip}
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
