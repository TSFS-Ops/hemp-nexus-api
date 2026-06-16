/**
 * FacilitationManagementMetrics — Batch 8 metrics strip.
 *
 * Loads via facilitation-management-metrics. Renders "Not available yet"
 * for any metric whose underlying timestamps do not exist yet.
 *
 * Read-only. Plain-English labels. No raw enum codes, no UUIDs.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { friendlyFacilitationError } from "@/lib/facilitation-labels";

type Metrics = {
  generated_at: string;
  cohort_size: number;
  headline: {
    open_cases: number;
    new_cases_this_week: number;
    new_cases_this_month: number;
    overdue_cases: number;
  };
  averages_hours: {
    time_to_owner_assignment: number | null;
    time_to_triage: number | null;
    time_to_first_outreach: number | null;
    time_to_close: number | null;
  };
  outcome_rates_pct: {
    conversion_to_poi: number | null;
    unable_to_contact: number | null;
    counterparty_declined: number | null;
    compliance_block: number | null;
    duplicate: number | null;
  };
  grouping: {
    by_country: { label: string; count: number }[];
    by_sector: { label: string; count: number }[];
  };
  sla_compliance_pct: number | null;
};

const NA = "Not available yet";

const fmtHours = (h: number | null): string => (h == null ? NA : h < 24 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} d`);
const fmtPct = (p: number | null): string => (p == null ? NA : `${p}%`);

export const FacilitationManagementMetrics: React.FC = () => {
  const [data, setData] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.functions.invoke<Metrics>("facilitation-management-metrics", {
          body: {},
        });
        if (cancelled) return;
        if (error) {
          // 403 → silently hide the panel (user just isn't management-authorised).
          const status = (error as { context?: { status?: number } }).context?.status;
          if (status === 403) { setForbidden(true); return; }
          throw error;
        }
        setData(res ?? null);
      } catch (err: unknown) {
        if (!cancelled) toast.error(await friendlyFacilitationError(err, "Could not load management metrics."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (forbidden) return null;
  if (loading) {
    return (
      <Card className="mb-4"><CardContent className="p-4"><Skeleton className="h-20 w-full" /></CardContent></Card>
    );
  }
  if (!data) return null;

  const Tile: React.FC<{ label: string; value: string | number }> = ({ label, value }) => (
    <div className="px-4 py-3 border border-slate-200 rounded-md bg-white">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900 mt-0.5">{value}</div>
    </div>
  );

  return (
    <Card className="mb-4 border-slate-200">
      <CardContent className="p-4 space-y-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Headline</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile label="Open cases" value={data.headline.open_cases} />
            <Tile label="New this week" value={data.headline.new_cases_this_week} />
            <Tile label="New this month" value={data.headline.new_cases_this_month} />
            <Tile label="Overdue" value={data.headline.overdue_cases} />
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Average times</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Tile label="To owner assignment" value={fmtHours(data.averages_hours.time_to_owner_assignment)} />
            <Tile label="To triage" value={fmtHours(data.averages_hours.time_to_triage)} />
            <Tile label="To first outreach" value={fmtHours(data.averages_hours.time_to_first_outreach)} />
            <Tile label="To close" value={fmtHours(data.averages_hours.time_to_close)} />
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Outcome rates</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Tile label="Conversion to POI" value={fmtPct(data.outcome_rates_pct.conversion_to_poi)} />
            <Tile label="Unable to contact" value={fmtPct(data.outcome_rates_pct.unable_to_contact)} />
            <Tile label="Counterparty declined" value={fmtPct(data.outcome_rates_pct.counterparty_declined)} />
            <Tile label="Compliance block" value={fmtPct(data.outcome_rates_pct.compliance_block)} />
            <Tile label="Duplicate" value={fmtPct(data.outcome_rates_pct.duplicate)} />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Tile label="SLA compliance" value={fmtPct(data.sla_compliance_pct)} />
          <div className="md:col-span-2 grid grid-cols-2 gap-3">
            <GroupList title="By country" items={data.grouping.by_country} />
            <GroupList title="By sector" items={data.grouping.by_sector} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

const GroupList: React.FC<{ title: string; items: { label: string; count: number }[] }> = ({ title, items }) => (
  <div className="px-3 py-2 border border-slate-200 rounded-md bg-white">
    <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">{title}</div>
    {items.length === 0 ? (
      <div className="text-sm text-slate-500">No data yet</div>
    ) : (
      <ul className="text-sm text-slate-700 space-y-0.5 max-h-32 overflow-auto">
        {items.map((i) => (
          <li key={i.label} className="flex justify-between">
            <span className="truncate pr-2">{i.label}</span>
            <span className="text-slate-500">{i.count}</span>
          </li>
        ))}
      </ul>
    )}
  </div>
);

export default FacilitationManagementMetrics;
