/**
 * GovernanceRecordDetail — HQ-only top summary + merged timeline for one
 * transaction. Anchor: match_id (primary). Falls back to poi_id or
 * engagement_id where given.
 *
 * Phase 1 only:
 *  - Reads existing audit sources via useGovernanceEvents.
 *  - Surfaces verification posture, current risk flag and demo/test/live
 *    label derived from already-fetched data; never invents values.
 *  - Renders the controlled HQ_DECISION_COPY inline for hq_decision rows.
 *  - Warns HQ when any source hit the per-source row cap.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GovernanceAnchor,
  useGovernanceEvents,
} from "@/lib/governance/use-governance-events";
import {
  DEMO_EVENT_COPY,
  EventCategory,
  GovernanceEvent,
  HQ_DECISION_COPY,
  NO_EVENT_COPY,
  statusCopy,
} from "@/lib/governance/governance-record";
import { GovernanceEventDrawer } from "./GovernanceEventDrawer";

interface Props {
  anchor: GovernanceAnchor;
}

function useMatchSummary(matchId: string | null | undefined) {
  return useQuery({
    queryKey: ["governance-match-summary", matchId],
    enabled: Boolean(matchId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select(
          "id, status, state, poi_state, commodity, buyer_org_id, seller_org_id, buyer_name, seller_name, settled_at, is_demo, created_at, finality_tokens_burned",
        )
        .eq("id", matchId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

function SummaryField({ label, value }: { label: string; value: React.ReactNode }) {
  const display =
    value === null || value === undefined || value === "" ? (
      <span className="text-muted-foreground">Not recorded</span>
    ) : (
      value
    );
  return (
    <div>
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1">
        {label}
      </p>
      <div className="font-mono text-xs text-foreground break-all">{display}</div>
    </div>
  );
}

const CATEGORY_LABEL: Record<EventCategory, string> = {
  trade_request: "Trade request",
  match: "Match",
  engagement: "Engagement",
  outreach: "Outreach",
  contact: "Contact",
  counterparty: "Counterparty",
  binding: "Binding",
  poi: "POI",
  wad: "WaD",
  execution: "Execution",
  admin_review: "Admin review",
  hq_decision: "HQ decision",
  dispute: "Dispute",
  credit: "Credit",
  payment: "Payment",
  evidence: "Evidence",
  finality: "Finality",
  memory: "Memory",
  export: "Export",
  sensitive_admin: "Sensitive admin",
  demo_test: "Demo/Test",
  other: "Other",
};

/** Latest event in a given category from already-fetched timeline. */
function latestByCategory(
  events: GovernanceEvent[] | undefined,
  cats: EventCategory[],
): GovernanceEvent | null {
  if (!events) return null;
  for (const e of events) {
    if (cats.includes(e.category)) return e;
  }
  return null;
}

export function GovernanceRecordDetail({ anchor }: Props) {
  const summary = useMatchSummary(anchor.matchId);
  const { data, isLoading, isError } = useGovernanceEvents(anchor);
  const events = data?.events;
  const capsHit = data?.capsHit ?? [];
  const [selected, setSelected] = useState<GovernanceEvent | null>(null);

  const recordRef = useMemo(() => {
    if (anchor.matchId) return `GR-MATCH-${anchor.matchId.slice(0, 8).toUpperCase()}`;
    if (anchor.poiId) return `GR-POI-${anchor.poiId.slice(0, 8).toUpperCase()}`;
    if (anchor.engagementId) return `GR-ENG-${anchor.engagementId.slice(0, 8).toUpperCase()}`;
    if (anchor.pendingEngagementId)
      return `GR-PE-${anchor.pendingEngagementId.slice(0, 8).toUpperCase()}`;
    return "GR-UNKNOWN";
  }, [anchor]);

  const m = summary.data;

  // ── Derived top-summary values (Phase 1 sources only). Never invent. ──
  const wadEvent = latestByCategory(events, ["wad"]);
  const wadStatus = wadEvent
    ? `${wadEvent.action}${wadEvent.status !== "neutral" ? ` (${wadEvent.status})` : ""}`
    : null;

  const creditEvent = latestByCategory(events, ["credit", "payment", "finality"]);
  const creditPayment = (() => {
    if (m?.finality_tokens_burned != null && m.finality_tokens_burned > 0) {
      return `${m.finality_tokens_burned} burned`;
    }
    if (creditEvent) {
      return `${creditEvent.action}${creditEvent.status !== "neutral" ? ` (${creditEvent.status})` : ""}`;
    }
    return null;
  })();

  // Current risk flag: derive from most-recent blocked / manual_review / dispute.
  const riskEvent = useMemo(() => {
    if (!events) return null;
    return (
      events.find(
        (e) =>
          e.status === "blocked" ||
          e.status === "manual_review" ||
          e.category === "dispute",
      ) ?? null
    );
  }, [events]);
  const riskFlag = riskEvent
    ? riskEvent.status === "blocked"
      ? `Blocked · ${riskEvent.reasonCode ?? riskEvent.action}`
      : riskEvent.status === "manual_review"
        ? `Manual review · ${riskEvent.action}`
        : `Dispute · ${riskEvent.action}`
    : null;

  // Verification posture: latest event carrying a posture label other than "Not recorded".
  const postureLabel = useMemo(() => {
    if (!events) return null;
    const e = events.find((x) => x.posture && x.posture !== "Not recorded");
    return e?.posture ?? null;
  }, [events]);

  // Demo / Test / Live label. Match flagged demo → Demo/Test. Match present
  // and not demo → Live. No match record → Not recorded.
  const demoTestLive: string | null = (() => {
    if (summary.isLoading) return null;
    if (!m) {
      // Fall back to events if any are flagged demo.
      if (events && events.some((e) => e.isDemo)) return "Demo/Test";
      return null;
    }
    if (m.is_demo) return "Demo/Test";
    return "Live";
  })();

  const lastEventTimestamp =
    events && events.length > 0
      ? format(new Date(events[0].occurredAt), "yyyy-MM-dd HH:mm")
      : null;

  return (
    <div className="space-y-6" data-testid="governance-record-detail">
      {/* Top summary */}
      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-mono text-[10px] tracking-[0.25em] uppercase text-muted-foreground">
                Governance Record
              </p>
              <p
                className="font-mono text-sm tracking-wider mt-1"
                data-testid="governance-record-ref"
              >
                {recordRef}
              </p>
            </div>
            {demoTestLive && (
              <Badge
                variant="outline"
                data-testid="demo-test-live-label"
                data-value={demoTestLive}
                className={
                  demoTestLive === "Demo/Test"
                    ? "bg-amber-50 border-amber-200 text-amber-800"
                    : "bg-emerald-50 border-emerald-200 text-emerald-800"
                }
              >
                {demoTestLive}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-4">
            <SummaryField label="Match ID" value={anchor.matchId ?? null} />
            <SummaryField label="Buyer organisation" value={m?.buyer_name ?? null} />
            <SummaryField label="Seller organisation" value={m?.seller_name ?? null} />
            <SummaryField label="Commodity / deal" value={m?.commodity ?? null} />
            <SummaryField label="POI status" value={m?.poi_state ?? null} />
            <SummaryField label="Counterparty status" value={m?.state ?? null} />
            <SummaryField label="WaD status" value={wadStatus} />
            <SummaryField label="Execution status" value={m?.status ?? null} />
            <SummaryField
              label="Finality status"
              value={m?.settled_at ? format(new Date(m.settled_at), "yyyy-MM-dd") : null}
            />
            <SummaryField label="Memory record" value={null} />
            <SummaryField label="Credit / payment" value={creditPayment} />
            <SummaryField label="Current risk flag" value={riskFlag} />
            <SummaryField label="Verification posture" value={postureLabel} />
            <SummaryField label="Demo / Test / Live" value={demoTestLive} />
            <SummaryField label="Last material event" value={lastEventTimestamp} />
          </div>
        </CardContent>
      </Card>

      {/* Per-source cap warning (HQ only — this whole component is HQ-only). */}
      {capsHit.length > 0 && (
        <div
          data-testid="row-cap-warning"
          className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-900"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              Some events may be hidden because this source reached the 500-row display limit.
              Narrow the filters or use a more specific record reference.
            </p>
            <p className="font-mono text-[10px] text-amber-800/80 mt-0.5">
              Affected sources: {capsHit.join(", ")}
            </p>
          </div>
        </div>
      )}

      {/* Timeline */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Merged timeline · audit_logs · admin_audit_logs · event_store · match_events
            </p>
            {events && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {events.length} event{events.length === 1 ? "" : "s"}
              </p>
            )}
          </div>

          {isLoading && (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {isError && (
            <div className="p-5 text-sm text-destructive">
              Failed to load governance events.
            </div>
          )}

          {!isLoading && !isError && events && events.length === 0 && (
            <div className="p-5 text-sm text-muted-foreground italic" data-testid="no-event-copy">
              {NO_EVENT_COPY}
            </div>
          )}

          {events && events.length > 0 && (
            <ul className="divide-y divide-border">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="px-5 py-3 hover:bg-muted/40 cursor-pointer"
                  onClick={() => setSelected(e)}
                  data-testid="governance-timeline-row"
                  data-source={e.source}
                  data-status={e.status}
                  data-category={e.category}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="font-mono text-xs text-foreground break-all">
                          {e.action}
                        </span>
                        <Badge variant="outline" className="text-[10px]">
                          {CATEGORY_LABEL[e.category]}
                        </Badge>
                        {e.status === "blocked" && (
                          <Badge variant="destructive" className="text-[10px]" data-testid="blocked-badge">
                            Blocked{e.reasonCode ? ` · ${e.reasonCode}` : ""}
                          </Badge>
                        )}
                        {e.status === "manual_review" && (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-200 text-amber-800">
                            Manual review
                          </Badge>
                        )}
                        {e.status === "allowed" && (
                          <Badge variant="outline" className="text-[10px] bg-emerald-50 border-emerald-200 text-emerald-800">
                            Allowed
                          </Badge>
                        )}
                        {e.isDemo && (
                          <Badge variant="outline" className="text-[10px]" data-testid="demo-badge">
                            Demo/Test
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {e.source}
                        </Badge>
                      </div>
                      {e.category === "hq_decision" && (
                        <p
                          className="text-[11px] text-emerald-800 leading-snug"
                          data-testid="hq-decision-copy"
                        >
                          {HQ_DECISION_COPY}
                        </p>
                      )}
                      {e.category !== "hq_decision" && e.status !== "neutral" && (
                        <p className="text-[11px] text-muted-foreground leading-snug">
                          {statusCopy(e)}
                        </p>
                      )}
                      {e.isDemo && (
                        <p className="text-[11px] text-amber-700 italic leading-snug">
                          {DEMO_EVENT_COPY}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {format(new Date(e.occurredAt), "yyyy-MM-dd HH:mm:ss")}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground/70 mt-0.5">
                        {e.actorType}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <GovernanceEventDrawer
        event={selected}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
