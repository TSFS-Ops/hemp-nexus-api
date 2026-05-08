/**
 * ReconfirmLateAcceptanceCard — Batch B Phase 8.5b
 *
 * Surfaces the only two workflow-authority actions a late acceptance allows:
 *
 *   • Reconfirm / Renew engagement → POST /poi-engagements/:id/reconfirm
 *   • Decline late acceptance      → POST /poi-engagements/:id/decline-late-acceptance
 *
 * The wording engine pin from `engagement-wording.ts` is the single source of
 * truth for visible copy. This card never claims the system declines on
 * the initiator's behalf, never says mutual / binding / final / settled /
 * executed, and never claims the counterparty's late acceptance has
 * progressed the workflow.
 *
 * Render conditions (all must be true):
 *   1. engagement.engagement_status === "late_acceptance_pending_initiator_reconfirmation"
 *   2. viewer's org === match.org_id (the initiating organisation)
 *   3. viewer holds the org_admin role
 *
 * Platform admin override:
 *   - If (1) is true and viewer holds platform_admin (but is NOT a member of
 *     the initiating org with org_admin), we still render — but with an
 *     explicit "Platform admin override" banner and a destructive accent so
 *     the action is visibly an admin override, not an ordinary participation
 *     action. This mirrors the server's separate audit channel
 *     (`pending_engagement.late_acceptance_resolved_via_platform_admin_override`).
 *
 * Hidden in every other case (counterparty org_admin, ordinary counterparty
 * member, unrelated org, ordinary initiator member without org_admin, any
 * other engagement status).
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, RefreshCcw, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useUserOrg } from "@/hooks/use-user-org";
import { fetchEdgeFunction } from "@/lib/edge-invoke";
import { queryClient } from "@/lib/query-client";
import { humaniseEngagementError } from "@/lib/humanise-engagement-error";
import { getEngagementWording } from "@/lib/engagement-wording";

export interface ReconfirmLateAcceptanceMatch {
  id: string;
  org_id: string;
  commodity?: string | null;
}

export interface ReconfirmLateAcceptanceEngagement {
  id?: string | null;
  engagement_status: string | null;
  reconfirmation_window_expires_at?: string | null;
}

interface Props {
  match: ReconfirmLateAcceptanceMatch;
  engagement: ReconfirmLateAcceptanceEngagement | null | undefined;
  /** Optional callback fired after a successful reconfirm/decline. */
  onResolved?: () => void;
}

type PendingAction = "reconfirm" | "decline-late-acceptance" | null;

function formatExpiry(ts?: string | null): string | null {
  if (!ts) return null;
  try {
    return new Date(ts).toLocaleString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function ReconfirmLateAcceptanceCard({ match, engagement, onResolved }: Props) {
  const { isOrgAdmin, isPlatformAdmin } = useAuth();
  const viewerOrgId = useUserOrg();
  const [pending, setPending] = useState<PendingAction>(null);
  const [submitting, setSubmitting] = useState<PendingAction>(null);

  // Gate 1: engagement must be in the late-acceptance reconfirmation window.
  if (
    !engagement ||
    !engagement.id ||
    engagement.engagement_status !== "late_acceptance_pending_initiator_reconfirmation"
  ) {
    return null;
  }

  // Gate 2: viewer must be on the initiating org with org_admin, OR a
  // platform_admin acting as override. We deliberately treat the union as
  // restrictive — we never grant access to ordinary org members or to
  // counterparty-side admins.
  const isInitiatorOrg = !!viewerOrgId && viewerOrgId === match.org_id;
  const isInitiatorOrgAdmin = isInitiatorOrg && isOrgAdmin && !isPlatformAdmin;
  // `isOrgAdmin` from AuthContext is true for platform_admin too, so the
  // override path is "platform_admin without being on the initiating org as
  // an ordinary org_admin". Also covers a platform_admin who happens to be
  // on the initiating org — surfaced as override + initiator role.
  const isPlatformOverride = isPlatformAdmin && !isInitiatorOrgAdmin;

  if (!isInitiatorOrgAdmin && !isPlatformOverride) return null;

  const wording = getEngagementWording({
    status: "late_acceptance_pending_initiator_reconfirmation",
  });

  const expiresLabel = formatExpiry(engagement.reconfirmation_window_expires_at);

  const callRoute = async (action: Exclude<PendingAction, null>) => {
    setSubmitting(action);
    try {
      await fetchEdgeFunction(`poi-engagements/${engagement.id}/${action}`, {
        method: "POST",
        label:
          action === "reconfirm"
            ? "reconfirm the late acceptance"
            : "decline the late acceptance",
      });
      queryClient.invalidateQueries({ queryKey: ["engagement-status-gate"] });
      queryClient.invalidateQueries({ queryKey: ["engagement-tracker"] });
      if (action === "reconfirm") {
        toast.success(
          "Renewed engagement created. The trading partner must accept the renewed engagement before the workflow can proceed.",
        );
      } else {
        toast.info(
          "Late acceptance declined. The late acceptance remains recorded and the original engagement remains expired.",
        );
      }
      onResolved?.();
    } catch (err) {
      const humanised = humaniseEngagementError(err);
      toast.error(humanised.headline, {
        description: humanised.hint ?? humanised.technical,
      });
    } finally {
      setSubmitting(null);
      setPending(null);
    }
  };

  const dialogCopy = (() => {
    if (pending === "reconfirm") {
      return {
        title: "Reconfirm and create a renewed engagement?",
        body: (
          <div className="space-y-2">
            <p>
              The original engagement remains expired. Reconfirming creates a
              renewed engagement that the trading partner must accept before
              the workflow can proceed.
            </p>
            <p className="text-sm">
              This does not seal a deal, does not record mutual acceptance,
              and does not start any POI, WaD, credit or payment side effects.
            </p>
          </div>
        ),
        confirmLabel: "Reconfirm",
        confirmClass: "",
      };
    }
    return {
      title: "Decline the late acceptance?",
      body: (
        <div className="space-y-2">
          <p>
            The late acceptance will remain recorded, but this engagement
            will remain expired and will not proceed.
          </p>
          <p className="text-sm">
            The trading partner will see that the initiator did not renew.
            No automatic decline takes place — this is your explicit decision.
          </p>
        </div>
      ),
      confirmLabel: "Decline late acceptance",
      confirmClass: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    };
  })();

  const isBusy = !!submitting;

  return (
    <>
      <Card
        className="border-amber-500/40 bg-amber-500/5"
        data-testid="reconfirm-late-acceptance-card"
        aria-labelledby="reconfirm-late-acceptance-heading"
      >
        <CardHeader className="space-y-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              <CardTitle
                id="reconfirm-late-acceptance-heading"
                className="flex items-center gap-2 text-lg"
              >
                <RefreshCcw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                {wording.headline}
              </CardTitle>
              <CardDescription>{wording.description}</CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <Badge
                variant="outline"
                className="text-xs border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {wording.badgeLabel}
              </Badge>
              {isPlatformOverride && (
                <Badge
                  variant="outline"
                  className="text-[10px] border-destructive/40 bg-destructive/10 text-destructive"
                  data-testid="platform-admin-override-badge"
                >
                  <ShieldAlert className="h-3 w-3 mr-1" />
                  Platform admin override
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {expiresLabel && (
            <p className="text-xs text-muted-foreground tabular-nums">
              Reconfirmation window: until {expiresLabel}. After that, the
              late acceptance remains recorded and the original engagement
              remains expired.
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => setPending("reconfirm")}
              disabled={isBusy}
              data-testid="reconfirm-late-acceptance-button"
              className="flex-1 sm:flex-none"
            >
              {submitting === "reconfirm" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCcw className="h-4 w-4 mr-2" />
              )}
              Reconfirm and renew engagement
            </Button>
            <Button
              variant="outline"
              onClick={() => setPending("decline-late-acceptance")}
              disabled={isBusy}
              data-testid="decline-late-acceptance-button"
              className="flex-1 sm:flex-none text-destructive border-destructive/30 hover:bg-destructive/5"
            >
              {submitting === "decline-late-acceptance" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4 mr-2" />
              )}
              Decline late acceptance
            </Button>
          </div>

          {isPlatformOverride && (
            <p className="text-xs text-destructive/80">
              You are acting as platform admin. This action will be recorded
              as a separately-audited override on behalf of the initiating
              organisation.
            </p>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialogCopy.title}</AlertDialogTitle>
            <AlertDialogDescription asChild>{dialogCopy.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="reconfirm-dialog-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pending && callRoute(pending)}
              className={dialogCopy.confirmClass}
              data-testid="reconfirm-dialog-confirm"
            >
              {dialogCopy.confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
