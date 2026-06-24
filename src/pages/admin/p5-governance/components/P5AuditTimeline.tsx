/**
 * P5AuditTimeline — Stage 4
 *
 * Renders immutable Stage 1 audit events. Append-only on the server side; this
 * component never offers an edit/delete affordance.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { P5StatusBadge } from "./P5StatusBadge";
import type { P5Status, P5ReasonCode } from "@/lib/p5-governance/constants";

export interface P5AuditEvent {
  id: string;
  created_at: string;
  event_type: string;
  actor_type: string;
  actor_user_id: string | null;
  previous_status: P5Status | null;
  new_status: P5Status | null;
  reason_code: P5ReasonCode | null;
  note: string | null;
}

export function P5AuditTimeline({ events }: { events: P5AuditEvent[] }) {
  if (!events.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit timeline</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No events recorded yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audit timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <ol
          className="relative border-l border-border pl-4 space-y-4"
          data-testid="p5-audit-timeline"
        >
          {events.map((e) => (
            <li key={e.id} className="text-sm">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(e.created_at).toISOString()}
                </span>
                <span className="font-medium">{e.event_type}</span>
                <span className="text-xs text-muted-foreground">({e.actor_type})</span>
                {e.previous_status && e.new_status && (
                  <span className="flex items-center gap-1">
                    <P5StatusBadge status={e.previous_status} />
                    <span>→</span>
                    <P5StatusBadge status={e.new_status} />
                  </span>
                )}
              </div>
              {e.reason_code && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  reason: <span className="font-mono">{e.reason_code}</span>
                </div>
              )}
              {e.note && <div className="mt-1 text-foreground">{e.note}</div>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
