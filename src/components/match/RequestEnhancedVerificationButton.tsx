/**
 * RequestEnhancedVerificationButton - visible, priced, user-facing entry
 * ────────────────────────────────────────────────────────────────────────
 * Implements Daniel Davies' two directives (2026-04-28):
 *
 *   (a) Make the "Request Enhanced Verification" affordance discoverable on
 *       the match page - not buried as a tiny ghost link.
 *   (b) Charge for it. Every use carries a price (provider cost + 80%
 *       Izenzo margin). The same pricing model applies if the clip-on is
 *       switched on permanently for a particular client integration.
 *
 * The verification clip-on remains admin-managed (HQ → Verification Queue).
 * Users only raise a *case*; admins do the actual review. Outcomes are
 * informational and do not block POI mint or any workflow step.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, ShieldQuestion, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Match } from "@/hooks/use-match-details";

type Status = "pending" | "in_progress" | "completed" | "cancelled";

interface OwnRequestRow {
  id: string;
  status: Status;
  outcome: "verified" | "rejected" | "inconclusive" | null;
  created_at: string;
  completed_at: string | null;
  priced_total_zar: number | null;
  priced_currency: string | null;
}

interface PricingConfig {
  currency: string;
  cost_per_request_zar: number;
  margin_pct: number;
  permanent_integration_monthly_zar: number;
  permanent_integration_margin_pct: number;
}

const STATUS_VARIANT: Record<Status, "default" | "secondary" | "outline" | "destructive"> = {
  pending: "outline",
  in_progress: "secondary",
  completed: "default",
  cancelled: "destructive",
};

const FALLBACK_PRICING: PricingConfig = {
  currency: "ZAR",
  cost_per_request_zar: 250,
  margin_pct: 80,
  permanent_integration_monthly_zar: 2500,
  permanent_integration_margin_pct: 80,
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(0)}`;
  }
}

export function RequestEnhancedVerificationButton({ match }: { match: Match }) {
  const { session, isPlatformAdmin } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);

  const { data: pricing = FALLBACK_PRICING } = useQuery({
    queryKey: ["operator-verification-clip-on-pricing"],
    queryFn: async () => {
      const { data } = await supabase
        .from("admin_settings")
        .select("value")
        .eq("key", "operator_verification_clip_on_pricing")
        .maybeSingle();
      const v = (data?.value as Partial<PricingConfig> | null) ?? null;
      return { ...FALLBACK_PRICING, ...(v ?? {}) } as PricingConfig;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Is the requesting user's org on the permanent (always-on) plan?
  const { data: orgPlan } = useQuery({
    queryKey: ["org-clip-on-plan", session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (!prof?.org_id) return { always_on: false };
      const { data: org } = await supabase
        .from("organizations")
        .select("clip_on_always_on")
        .eq("id", prof.org_id)
        .maybeSingle();
      return { always_on: !!org?.clip_on_always_on };
    },
  });
  const alwaysOn = !!orgPlan?.always_on;

  const totalPerRequest =
    pricing.cost_per_request_zar * (1 + pricing.margin_pct / 100);
  const totalPermanentMonthly =
    pricing.permanent_integration_monthly_zar *
    (1 + pricing.permanent_integration_margin_pct / 100);

  // Credits the DB will burn at pickup: max(1, ceil(priced_total_zar / 10)).
  // Mirrors bill_clip_on_request so the pre-warn is exact, not approximate.
  const creditsRequired = Math.max(1, Math.ceil(totalPerRequest / 10));

  // Pull the org's live wallet balance so we can pre-warn before the user
  // accepts the charge. Skipped for always-on orgs (subscription path -
  // no per-request burn). Re-fetched whenever the dialog opens.
  const { data: balanceRow } = useQuery({
    queryKey: ["org-credit-balance-for-clip-on", session?.user.id, open],
    enabled: !!session && !alwaysOn && open,
    queryFn: async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session!.user.id)
        .maybeSingle();
      if (!prof?.org_id) return { balance: null as number | null };
      const { data: bal } = await supabase
        .from("token_balances")
        .select("balance")
        .eq("org_id", prof.org_id)
        .maybeSingle();
      return { balance: (bal?.balance as number | undefined) ?? 0 };
    },
    staleTime: 30 * 1000,
  });
  const currentBalance = balanceRow?.balance ?? null;
  const insufficient =
    !alwaysOn && currentBalance !== null && currentBalance < creditsRequired;

  const { data: ownRows = [] } = useQuery({
    queryKey: ["own-verification-requests", match.id, session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("operator_verification_requests")
        .select("id, status, outcome, created_at, completed_at, priced_total_zar, priced_currency")
        .eq("match_id", match.id)
        .eq("raised_by", session!.user.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as OwnRequestRow[];
    },
  });

  if (!session) return null;

  const requestOrgQuery = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", session!.user.id)
      .maybeSingle();
    if (error) throw error;
    if (data?.org_id) return data.org_id as string;
    if (isPlatformAdmin && (match as any).org_id) return (match as any).org_id as string;
    return null;
  };

  const handleSubmit = async () => {
    if (!session) return;
    if (!alwaysOn && !acknowledged) {
      toast.error("Please confirm you accept the additional charge.");
      return;
    }
    setSubmitting(true);
    try {
      const orgId = await requestOrgQuery();
      if (!orgId) {
        toast.error("Your profile is not linked to an organisation.");
        return;
      }
      const myOrgId = orgId;
      const counterpartyName =
        ((match as any).buyer_id === myOrgId ? match.seller_name : match.buyer_name) ||
        match.seller_name ||
        match.buyer_name ||
        "Counterparty";

      const { error } = await supabase
        .from("operator_verification_requests")
        .insert({
          match_id: match.id,
          org_id: orgId,
          subject_org_id: null,
          subject_name: counterpartyName,
          kind: "both",
          status: "pending",
          reason: reason.trim() || null,
          raised_by: session.user.id,
          priced_cost_zar: pricing.cost_per_request_zar,
          priced_margin_pct: pricing.margin_pct,
          priced_total_zar: totalPerRequest,
          priced_currency: pricing.currency,
          pricing_mode: "per_request",
        });
      if (error) {
        if ((error as any).code === "23505") {
          toast.error("You already have an open verification request for this match. The Izenzo team is reviewing it.");
        } else {
          throw error;
        }
        return;
      }

      await supabase.from("audit_logs").insert([{
        org_id: orgId,
        actor_user_id: session.user.id,
        action: "verification.requested_by_user",
        entity_type: "match",
        entity_id: match.id,
        metadata: {
          counterparty: counterpartyName,
          reason_len: reason.trim().length,
          priced_total_zar: totalPerRequest,
          priced_cost_zar: pricing.cost_per_request_zar,
          priced_margin_pct: pricing.margin_pct,
          pricing_mode: "per_request",
        },
      }]);

      toast.success(`Request sent. ${formatMoney(totalPerRequest, pricing.currency)} will be billed once a reviewer picks it up.`);
      setOpen(false);
      setReason("");
      setAcknowledged(false);
      qc.invalidateQueries({ queryKey: ["own-verification-requests", match.id] });
    } catch (e: any) {
      toast.error(`Could not send request: ${e?.message ?? "unknown error"}`);
    } finally {
      setSubmitting(false);
    }
  };

  const openRow = ownRows.find((r) => r.status === "pending" || r.status === "in_progress");
  const latest = ownRows[0];

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-md bg-muted p-2">
            <ShieldQuestion className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium leading-tight">
              Need extra comfort on the other side?
            </p>
            <p className="text-xs text-muted-foreground leading-snug max-w-prose">
              You can ask the Izenzo team to run an enhanced verification on your
              counterparty. Reviewer-managed, audit-logged, and informational -
              it never blocks your trading workflow. Additional charge applies:{" "}
              <span className="font-medium text-foreground">
                {formatMoney(totalPerRequest, pricing.currency)}
              </span>{" "}
              per request.
            </p>
            {latest && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
                <span>Your last request:</span>
                <Badge variant={STATUS_VARIANT[latest.status]} className="text-[10px] capitalize">
                  {latest.status.replace("_", " ")}
                </Badge>
                {latest.outcome && (
                  <Badge variant="outline" className="text-[10px] capitalize">
                    {latest.outcome}
                  </Badge>
                )}
                {latest.priced_total_zar != null && (
                  <span className="text-[10px]">
                    · {formatMoney(Number(latest.priced_total_zar), latest.priced_currency || pricing.currency)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setAcknowledged(false); }}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0" disabled={!!openRow}>
              <ShieldQuestion className="h-3.5 w-3.5" />
              {openRow ? "Verification request pending" : "Request enhanced verification"}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Request enhanced verification</DialogTitle>
              <DialogDescription>
                Send a request to the Izenzo team to perform additional checks
                on the other side of this match. A reviewer will action the
                case and the outcome will be recorded against this match. This
                does not block any part of your trading workflow.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <Receipt className="h-3.5 w-3.5" />
                  Pricing
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider cost</span>
                  <span>{formatMoney(pricing.cost_per_request_zar, pricing.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Izenzo margin ({pricing.margin_pct}%)</span>
                  <span>{formatMoney(pricing.cost_per_request_zar * (pricing.margin_pct / 100), pricing.currency)}</span>
                </div>
                <Separator className="my-1" />
                <div className="flex justify-between font-medium text-foreground">
                  <span>You will be billed</span>
                  <span>{formatMoney(totalPerRequest, pricing.currency)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Charged when a reviewer picks the case up. Cancel before then
                  and nothing is billed. If your organisation has the clip-on
                  switched on permanently, the equivalent monthly charge applies
                  instead ({formatMoney(totalPermanentMonthly, pricing.currency)}/month).
                </p>
              </div>

              {/* Pre-warn: live wallet check before the user accepts the
                  charge. Mirrors the DB-side check in bill_clip_on_request,
                  so what the user sees here matches what gets enforced
                  when a reviewer picks the case up. */}
              {!alwaysOn && currentBalance !== null && (
                <div
                  className={
                    "rounded-md border p-3 text-xs " +
                    (insufficient
                      ? "border-destructive/40 bg-destructive/5 text-destructive"
                      : "border-border bg-muted/30 text-muted-foreground")
                  }
                  data-testid="clip-on-balance-prewarn"
                >
                  <div className="flex justify-between">
                    <span>Credits required</span>
                    <span className="font-mono">{creditsRequired}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Your current balance</span>
                    <span className="font-mono">{currentBalance}</span>
                  </div>
                  {insufficient && (
                    <p className="pt-2 leading-snug">
                      Your wallet does not have enough credits for this request.
                      You can still send it, but a reviewer will not be able
                      to pick it up until your balance reaches {creditsRequired}.
                      Top up in <span className="font-medium">Settings → Billing</span>.
                    </p>
                  )}
                </div>
              )}

              <div>
                <Label className="text-xs">Why are you asking? (optional)</Label>
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Anything specific you'd like the reviewer to look at?"
                  rows={3}
                  className="mt-1 text-sm"
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I accept the{" "}
                  <span className="font-medium text-foreground">
                    {formatMoney(totalPerRequest, pricing.currency)}
                  </span>{" "}
                  charge for this enhanced verification request.
                </span>
              </label>
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !acknowledged}>
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                Send request &amp; accept charge
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
