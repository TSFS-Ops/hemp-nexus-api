/**
 * P012 — Unknown-counterparty facilitation timeline panel (requester view).
 *
 * Renders only user-visible timeline rows. All copy strings come from
 * src/lib/unknown-cp-timeline.ts SSOT.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import {
  UNKNOWN_CP_PANEL_HEADING,
  UNKNOWN_CP_PANEL_SUBHEADING,
  UNKNOWN_CP_SLA_NOTE,
  UNKNOWN_CP_STATUS_LABEL,
  UNKNOWN_CP_STATUS_COPY,
  UNKNOWN_CP_INTERNAL_ONLY_STATUSES,
  UNKNOWN_CP_BLOCKED_PROGRESSION_COPY,
  getAllowedActions,
  type UnknownCpStatus,
} from "@/lib/unknown-cp-timeline";
import { AddMoreInformationDialog } from "./AddMoreInformationDialog";
import { ContactSupportDialog } from "./ContactSupportDialog";
import { CancelRequestDialog } from "./CancelRequestDialog";
import { Button } from "@/components/ui/button";

interface TimelineEvent {
  id: string;
  new_status: UnknownCpStatus;
  status_label: string;
  user_facing_copy: string;
  user_visible: boolean;
  timestamp_utc: string;
}

interface Overlay {
  user_facing_status: UnknownCpStatus;
  status_group: string;
  is_overdue_review: boolean;
  is_overdue_outreach: boolean;
}

export function UnknownCpTimelinePanel({ facilitationCaseId }: { facilitationCaseId: string }) {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState<null | "more" | "support" | "cancel">(null);

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: o }, { data: e }] = await Promise.all([
        supabase
          .from("unknown_cp_case_overlays")
          .select("user_facing_status, status_group, is_overdue_review, is_overdue_outreach")
          .eq("facilitation_case_id", facilitationCaseId)
          .maybeSingle(),
        supabase
          .from("unknown_cp_timeline_events")
          .select("id, new_status, status_label, user_facing_copy, user_visible, timestamp_utc")
          .eq("facilitation_case_id", facilitationCaseId)
          .eq("user_visible", true)
          .order("timestamp_utc", { ascending: true }),
      ]);
      setOverlay((o as Overlay) ?? null);
      setEvents(((e as TimelineEvent[]) ?? []).filter(
        (ev) => !UNKNOWN_CP_INTERNAL_ONLY_STATUSES.has(ev.new_status),
      ));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facilitationCaseId]);

  if (loading) return null;
  if (!overlay) return null;

  const status = overlay.user_facing_status;
  const allowed = getAllowedActions(status);
  const slaLabel = overlay.is_overdue_review || overlay.is_overdue_outreach
    ? "Review overdue"
    : overlay.status_group === "awaiting"
      ? "Awaiting response"
      : overlay.status_group === "outcome" || overlay.status_group === "closed"
        ? "Outcome recorded"
        : "Review pending";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle>{UNKNOWN_CP_PANEL_HEADING}</CardTitle>
            <CardDescription>{UNKNOWN_CP_PANEL_SUBHEADING}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} label={UNKNOWN_CP_STATUS_LABEL[status]} />
            <StatusBadge status="pending" label={slaLabel} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{UNKNOWN_CP_STATUS_COPY[status]}</p>

        <Alert>
          <AlertDescription className="text-xs">{UNKNOWN_CP_SLA_NOTE}</AlertDescription>
        </Alert>

        <ol className="border-l border-border pl-4 space-y-3" data-testid="ucp-timeline">
          {events.map((ev) => (
            <li key={ev.id} className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{ev.status_label}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(ev.timestamp_utc).toLocaleString()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{ev.user_facing_copy}</p>
            </li>
          ))}
        </ol>

        {!allowed.progressToWaD && (
          <Alert variant="default" data-testid="ucp-blocked-progression">
            <AlertDescription className="text-xs">
              {UNKNOWN_CP_BLOCKED_PROGRESSION_COPY}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {allowed.addMoreInformation && (
            <Button variant="outline" size="sm" onClick={() => setOpenDialog("more")}>
              Add more information
            </Button>
          )}
          {allowed.contactSupport && (
            <Button variant="outline" size="sm" onClick={() => setOpenDialog("support")}>
              Contact support
            </Button>
          )}
          {allowed.cancelRequest && (
            <Button variant="ghost" size="sm" onClick={() => setOpenDialog("cancel")}>
              Cancel request
            </Button>
          )}
        </div>
      </CardContent>

      <AddMoreInformationDialog
        open={openDialog === "more"}
        onOpenChange={(v) => setOpenDialog(v ? "more" : null)}
        facilitationCaseId={facilitationCaseId}
        onCompleted={load}
      />
      <ContactSupportDialog
        open={openDialog === "support"}
        onOpenChange={(v) => setOpenDialog(v ? "support" : null)}
        facilitationCaseId={facilitationCaseId}
        onCompleted={load}
      />
      <CancelRequestDialog
        open={openDialog === "cancel"}
        onOpenChange={(v) => setOpenDialog(v ? "cancel" : null)}
        facilitationCaseId={facilitationCaseId}
        onCompleted={load}
      />
    </Card>
  );
}
