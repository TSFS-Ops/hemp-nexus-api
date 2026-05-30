/**
 * GovernanceRecordDetail — HQ-only top summary + merged timeline for one
 * transaction. Anchor: match_id (primary). Falls back to poi_id or
 * engagement_id where given.
 *
 * Phase 1 + alignment patch:
 *  - Reads existing audit sources via useGovernanceEvents.
 *  - Surfaces verification posture, current risk flag and demo/test/live
 *    label derived from already-fetched data; never invents values.
 *  - Renders the controlled HQ_DECISION_COPY inline for hq_decision rows.
 *  - Warns HQ when any source hit the per-source row cap.
 *  - Deterministic non-AI "full story" summary at the top (§38).
 *  - Memory record field renders "Not wired in this build" with HQ tooltip.
 *  - HQ filters: actor type, organisation, event family, exact event type,
 *    POI ID, engagement ID, WaD ID, payment reference, allowed/blocked,
 *    posture, risk flag, demo/live (document filters intentionally excluded).
 *  - Identical repeated events within 5 min collapse into one row with
 *    "repeated [x] times" — underlying events accessible via the drawer.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { format } from "date-fns";
import { AlertTriangle, HelpCircle, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  GovernanceAnchor,
  useGovernanceEvents,
} from "@/lib/governance/use-governance-events";
import {
  DEMO_EVENT_COPY,
  EventCategory,
  GovernanceEvent,
  HQ_DECISION_COPY,
  HQ_CORRECTED_BADGE_COPY,
  MEMORY_NOT_WIRED_COPY,
  NO_EVENT_COPY,
  annotateCorrections,
  buildFullStorySummary,
  groupRepeatedEvents,
  statusCopy,
} from "@/lib/governance/governance-record";
import { GovernanceEventDrawer } from "./GovernanceEventDrawer";
import { HqNotesPanel } from "./HqNotesPanel";
import { GovernanceWaiversPanel } from "./GovernanceWaiversPanel";


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

function SummaryField({
  label,
  value,
  tooltip,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  tooltip?: string;
  testId?: string;
}) {
  const display =
    value === null || value === undefined || value === "" ? (
      <span className="text-muted-foreground">Not recorded</span>
    ) : (
      value
    );
  return (
    <div data-testid={testId}>
      <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-1 flex items-center gap-1">
        {label}
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle
                  className="h-3 w-3 text-muted-foreground/70 cursor-help"
                  aria-label={`${label} help`}
                />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                {tooltip}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
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
  hq_note: "HQ note",
  hq_correction: "HQ correction",
  waiver_grant: "Waiver/Bypass grant",
  waiver_consumed: "Waiver/Bypass consumed",
  waiver_expired: "Waiver/Bypass expired",

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

const CATEGORY_VALUES = Object.keys(CATEGORY_LABEL) as EventCategory[];

const ACTOR_TYPES = [
  "System",
  "User",
  "Organisation Admin",
  "HQ Admin",
  "Provider",
  "Scheduled Job",
  "Payment Provider",
  "Notification Service",
  "Unknown actor — needs review",
] as const;

const POSTURE_OPTIONS = [
  "Standard",
  "Pending Verification",
  "Manual Review Required",
  "Waiver Applied",
  "Bypass Applied",
  "Demo/Test",
  "Failed Verification",
  "Expired/Stale Verification",
  "Not recorded",
] as const;

const ANY = "__any__";

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

interface EventFilters {
  actorType: string;
  orgId: string;
  family: string;
  eventType: string;
  poiId: string;
  engagementId: string;
  wadId: string;
  paymentRef: string;
  allowedBlocked: string;
  posture: string;
  riskFlag: string;
  demoLive: string;
}

const EMPTY_FILTERS: EventFilters = {
  actorType: ANY,
  orgId: "",
  family: ANY,
  eventType: "",
  poiId: "",
  engagementId: "",
  wadId: "",
  paymentRef: "",
  allowedBlocked: ANY,
  posture: ANY,
  riskFlag: ANY,
  demoLive: ANY,
};

export function applyEventFilters(
  events: GovernanceEvent[],
  f: EventFilters,
): GovernanceEvent[] {
  const norm = (s: string) => s.trim().toLowerCase();
  return events.filter((e) => {
    if (f.actorType !== ANY && e.actorType !== f.actorType) return false;
    if (f.orgId && norm(e.links.orgId ?? "") !== norm(f.orgId)) return false;
    if (f.family !== ANY && e.category !== f.family) return false;
    if (f.eventType && !e.action.toLowerCase().includes(norm(f.eventType))) return false;
    if (f.poiId && norm(e.links.poiId ?? "") !== norm(f.poiId)) return false;
    if (
      f.engagementId &&
      norm(e.links.engagementId ?? "") !== norm(f.engagementId)
    )
      return false;
    if (f.wadId && norm(e.links.wadId ?? "") !== norm(f.wadId)) return false;
    if (
      f.paymentRef &&
      norm(e.links.paymentReference ?? "") !== norm(f.paymentRef)
    )
      return false;
    if (f.allowedBlocked !== ANY && e.status !== f.allowedBlocked) return false;
    if (f.posture !== ANY && e.posture !== f.posture) return false;
    if (f.riskFlag === "risk_only") {
      if (e.status !== "blocked" && e.status !== "manual_review") return false;
    }
    if (f.demoLive === "demo" && !e.isDemo) return false;
    if (f.demoLive === "live" && e.isDemo) return false;
    return true;
  });
}

export function GovernanceRecordDetail({ anchor }: Props) {
  const summary = useMatchSummary(anchor.matchId);
  const { isPlatformAdmin } = useAuth();
  const { data, isLoading, isError } = useGovernanceEvents(anchor);
  const events = data?.events;
  const capsHit = data?.capsHit ?? [];
  const [selected, setSelected] = useState<GovernanceEvent | null>(null);
  const [filters, setFilters] = useState<EventFilters>(EMPTY_FILTERS);
  const [correctingEventId, setCorrectingEventId] = useState<string | null>(null);

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

  // ── Deterministic "full story" summary (§38). Non-AI, no documentation. ──
  const executionEvent = latestByCategory(events, ["execution"]);
  const executionStatus = executionEvent
    ? executionEvent.status === "blocked"
      ? "blocked"
      : executionEvent.status === "allowed"
        ? "permitted"
        : "not recorded"
    : m?.status === "settled"
      ? "permitted"
      : "not recorded";
  const executionReason =
    executionEvent?.reasonCode ??
    (executionEvent?.status === "allowed" ? "required conditions satisfied" : null);
  const fullStory = buildFullStorySummary({
    recordStatus: m?.state ?? m?.status ?? null,
    poiStatus: m?.poi_state ?? null,
    wadStatus: wadStatus,
    executionStatus,
    executionReason,
    lastEvent: events && events.length > 0
      ? { action: events[0].action, occurredAt: events[0].occurredAt }
      : null,
  });

  // ── Annotated + filtered + grouped timeline (Batch B: correction hints) ──
  const annotated = useMemo(
    () => (events ? annotateCorrections(events) : []),
    [events],
  );
  const filtered = useMemo(
    () => applyEventFilters(annotated, filters),
    [annotated, filters],
  );
  const grouped = useMemo(() => groupRepeatedEvents(filtered), [filtered]);

  const setF = <K extends keyof EventFilters>(k: K, v: EventFilters[K]) =>
    setFilters((prev) => ({ ...prev, [k]: v }));
  const resetFilters = () => setFilters(EMPTY_FILTERS);
  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([, v]) =>
        v === ANY ? false : Boolean(v && v !== ""),
      ).length,
    [filters],
  );

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

          {/* Deterministic non-AI full-story summary (§38). */}
          <p
            data-testid="governance-full-story"
            className="text-xs text-foreground leading-relaxed bg-muted/30 border border-border rounded-sm px-3 py-2"
          >
            {fullStory}
          </p>

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
            <SummaryField
              label="Memory record"
              testId="memory-record-field"
              value={
                <span className="text-muted-foreground italic">
                  Not wired in this build
                </span>
              }
              tooltip={MEMORY_NOT_WIRED_COPY}
            />
            <SummaryField label="Credit / payment" value={creditPayment} />
            <SummaryField label="Current risk flag" value={riskFlag} />
            <SummaryField label="Verification posture" value={postureLabel} />
            <SummaryField label="Demo / Test / Live" value={demoTestLive} />
            <SummaryField label="Last material event" value={lastEventTimestamp} />
          </div>
        </CardContent>
      </Card>

      {/* Batch B — HQ Notes panel */}
      <HqNotesPanel
        anchor={anchor}
        orgId={m?.buyer_org_id ?? m?.seller_org_id ?? null}
        correctingEventId={correctingEventId}
        onCorrectingHandled={() => setCorrectingEventId(null)}
      />

      {/* Batch D — Governance waivers / bypasses panel */}
      <GovernanceWaiversPanel
        anchor={anchor}
        orgId={m?.buyer_org_id ?? m?.seller_org_id ?? null}
      />




      {/* Per-source cap warning (HQ only). */}
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

      {/* HQ filters (non-document) */}
      <Card>
        <CardContent className="p-4" data-testid="governance-filters">
          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Filters · {activeFilterCount} active
            </p>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={resetFilters}
                data-testid="governance-filters-reset"
                className="text-[11px] underline text-muted-foreground hover:text-foreground"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Actor type
              </label>
              <Select
                value={filters.actorType}
                onValueChange={(v) => setF("actorType", v)}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="filter-actor-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  {ACTOR_TYPES.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Event family
              </label>
              <Select value={filters.family} onValueChange={(v) => setF("family", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-family">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  {CATEGORY_VALUES.map((c) => (
                    <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Allowed / blocked
              </label>
              <Select
                value={filters.allowedBlocked}
                onValueChange={(v) => setF("allowedBlocked", v)}
              >
                <SelectTrigger className="h-8 text-xs" data-testid="filter-allowed-blocked">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="allowed">Allowed</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="manual_review">Manual review</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Posture
              </label>
              <Select value={filters.posture} onValueChange={(v) => setF("posture", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-posture">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  {POSTURE_OPTIONS.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Risk flag
              </label>
              <Select value={filters.riskFlag} onValueChange={(v) => setF("riskFlag", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-risk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="risk_only">Risk only (blocked + manual review)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Demo / live
              </label>
              <Select value={filters.demoLive} onValueChange={(v) => setF("demoLive", v)}>
                <SelectTrigger className="h-8 text-xs" data-testid="filter-demo-live">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY}>Any</SelectItem>
                  <SelectItem value="demo">Demo/Test only</SelectItem>
                  <SelectItem value="live">Live only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Exact event type
              </label>
              <Input
                className="h-8 text-xs"
                value={filters.eventType}
                onChange={(e) => setF("eventType", e.target.value)}
                placeholder="e.g. poi.state_changed"
                data-testid="filter-event-type"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Organisation ID
              </label>
              <Input
                className="h-8 text-xs"
                value={filters.orgId}
                onChange={(e) => setF("orgId", e.target.value)}
                placeholder="uuid"
                data-testid="filter-org-id"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                POI ID
              </label>
              <Input
                className="h-8 text-xs"
                value={filters.poiId}
                onChange={(e) => setF("poiId", e.target.value)}
                placeholder="uuid"
                data-testid="filter-poi-id"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Engagement ID
              </label>
              <Input
                className="h-8 text-xs"
                value={filters.engagementId}
                onChange={(e) => setF("engagementId", e.target.value)}
                placeholder="uuid"
                data-testid="filter-engagement-id"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                WaD ID
              </label>
              <Input
                className="h-8 text-xs"
                value={filters.wadId}
                onChange={(e) => setF("wadId", e.target.value)}
                placeholder="uuid"
                data-testid="filter-wad-id"
              />
            </div>
            <div>
              <label className="font-mono text-[10px] uppercase text-muted-foreground">
                Payment reference
              </label>
              <Input
                className="h-8 text-xs"
                value={filters.paymentRef}
                onChange={(e) => setF("paymentRef", e.target.value)}
                placeholder="ref"
                data-testid="filter-payment-ref"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardContent className="p-0">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Merged timeline · audit_logs · admin_audit_logs · event_store · match_events
            </p>
            {events && (
              <p className="font-mono text-[10px] text-muted-foreground">
                {grouped.length} row{grouped.length === 1 ? "" : "s"} ·{" "}
                {filtered.length} event{filtered.length === 1 ? "" : "s"}
                {filtered.length !== events.length && ` (of ${events.length})`}
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

          {events && events.length > 0 && grouped.length === 0 && (
            <div
              className="p-5 text-sm text-muted-foreground italic"
              data-testid="no-events-after-filters"
            >
              No events match the current filters.
            </div>
          )}

          {grouped.length > 0 && (
            <ul className="divide-y divide-border">
              {grouped.map((e) => (
                <li
                  key={e.id}
                  className="px-5 py-3 hover:bg-muted/40 cursor-pointer"
                  onClick={() => setSelected(e)}
                  data-testid="governance-timeline-row"
                  data-source={e.source}
                  data-status={e.status}
                  data-category={e.category}
                  data-repeated={e.repeatedCount}
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
                        {e.repeatedCount > 1 && (
                          <Badge
                            variant="secondary"
                            className="text-[10px]"
                            data-testid="repeated-badge"
                          >
                            repeated {e.repeatedCount} times
                          </Badge>
                        )}
                        {e.correctedBy && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span
                                  className="inline-flex"
                                  data-testid="corrected-badge"
                                  data-correction-event-id={e.correctedBy.eventId}
                                >
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] bg-amber-50 border-amber-300 text-amber-900 cursor-help"
                                  >
                                    {HQ_CORRECTED_BADGE_COPY}
                                  </Badge>
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs text-xs space-y-1">
                                <p className="font-medium">{HQ_CORRECTED_BADGE_COPY}</p>
                                <p className="font-mono text-[10px] break-all">
                                  Correction event: {e.correctedBy.eventId}
                                </p>
                                <p className="font-mono text-[10px]">
                                  {format(new Date(e.correctedBy.occurredAt), "yyyy-MM-dd HH:mm:ss")}
                                </p>
                                {e.correctedBy.actorId && (
                                  <p className="font-mono text-[10px] break-all">
                                    By: {e.correctedBy.actorId}
                                  </p>
                                )}
                                {e.correctedBy.reasonCode && (
                                  <p className="font-mono text-[10px]">
                                    Reason: {e.correctedBy.reasonCode}
                                  </p>
                                )}
                                <p className="text-[10px] text-muted-foreground italic">
                                  Original event is preserved unedited.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
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
                    <div className="text-right shrink-0 flex flex-col items-end gap-1">
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {format(new Date(e.occurredAt), "yyyy-MM-dd HH:mm:ss")}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground/70">
                        {e.actorType}
                      </p>
                      {isPlatformAdmin &&
                        e.source === "event_store" &&
                        e.sourceRowId &&
                        e.action !== "hq.event_corrected" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-[10px] gap-1"
                            data-testid="correct-event-button"
                            data-source-row-id={e.sourceRowId}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setCorrectingEventId(String(e.sourceRowId));
                            }}
                          >
                            <Pencil className="h-3 w-3" aria-hidden />
                            Correct this event
                          </Button>
                        )}
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

      {isPlatformAdmin && anchor.matchId && (
        <AdminGovernanceExportRequestPanel
          governanceRecordId={anchor.matchId}
          recordRef={recordRef}
        />
      )}
    </div>
  );
}
