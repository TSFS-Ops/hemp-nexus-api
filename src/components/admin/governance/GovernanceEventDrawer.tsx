/**
 * GovernanceEventDrawer - HQ-only event detail dialog.
 * Shows source, ids, actor, posture, redacted metadata. Never raw payloads.
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

import { format } from "date-fns";
import {
  GovernanceEvent,
  statusCopy,
  DEMO_EVENT_COPY,
  HQ_DECISION_COPY,
} from "@/lib/governance/governance-record";

interface Props {
  event: GovernanceEvent | null;
  open: boolean;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-1.5 text-xs">
      <div className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-foreground break-all">{value ?? "Not recorded"}</div>
    </div>
  );
}

export function GovernanceEventDrawer({ event, open, onClose }: Props) {
  if (!event) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="governance-event-drawer">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm tracking-wide">
            {event.action}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Source: <span className="font-mono">{event.source}</span> · Category:{" "}
            <span className="font-mono">{event.category}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mb-2">
          <Badge variant={event.status === "blocked" ? "destructive" : "secondary"}>
            {event.status}
          </Badge>
          {event.isDemo && (
            <Badge variant="outline" data-testid="demo-badge">Demo/Test</Badge>
          )}
          <Badge variant="outline">{event.posture}</Badge>
          <Badge variant="outline">{event.actorType}</Badge>
        </div>

        {event.status !== "neutral" && (
          <p className="text-xs text-muted-foreground italic mb-2">{statusCopy(event)}</p>
        )}
        {event.isDemo && (
          <p className="text-xs text-amber-700 italic mb-2">{DEMO_EVENT_COPY}</p>
        )}
        {event.category === "hq_decision" && (
          <p className="text-xs text-muted-foreground italic mb-2">{HQ_DECISION_COPY}</p>
        )}

        <div className="max-h-[420px] overflow-y-auto pr-3">
          <div className="border-t border-border pt-3">
            <Row label="Event source" value={event.source} />
            <Row label="Source row id" value={event.sourceRowId} />
            <Row label="Action / type" value={event.action} />
            <Row
              label="Timestamp"
              value={format(new Date(event.occurredAt), "yyyy-MM-dd HH:mm:ss")}
            />
            <Row label="Actor" value={event.actorId ?? "Unknown"} />
            <Row label="Actor type" value={event.actorType} />
            <Row label="Previous state" value={event.prevState} />
            <Row label="New state" value={event.newState} />
            <Row label="Status" value={event.status} />
            <Row label="Reason code" value={event.reasonCode} />
            <Row label="Posture" value={event.posture} />
            {/* Phase 2 canonical fields (event_store payload). Read from
                redacted safeMetadata so legacy rows fall back to "Not recorded". */}
            <Row
              label="Policy version"
              value={(event.safeMetadata?.policy_version as string) ?? null}
            />
            <Row
              label="Source function"
              value={(event.safeMetadata?.source_function as string) ?? null}
            />
            <Row
              label="Correlation id"
              value={(event.safeMetadata?.correlation_id as string) ?? null}
            />
            <Row
              label="Request id"
              value={(event.safeMetadata?.request_id as string) ?? null}
            />
            <Row label="Match id" value={event.links.matchId} />
            <Row label="POI id" value={event.links.poiId} />
            <Row label="Engagement id" value={event.links.engagementId} />
            <Row label="WaD id" value={event.links.wadId} />
            <Row label="Payment reference" value={event.links.paymentReference} />
            <Row label="Org id" value={event.links.orgId} />
            <Row label="Source table" value={event.source} />
          </div>

          <div className="border-t border-border pt-3 mt-3">
            <p className="font-mono text-[10px] tracking-wider uppercase text-muted-foreground mb-2">
              Safe metadata (redacted)
            </p>
            <pre
              data-testid="safe-metadata"
              className="text-[11px] font-mono bg-muted/40 p-3 rounded-sm overflow-x-auto whitespace-pre-wrap break-all"
            >
              {JSON.stringify(event.safeMetadata, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
