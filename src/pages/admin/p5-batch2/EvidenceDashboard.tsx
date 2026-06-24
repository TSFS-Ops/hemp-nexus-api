/**
 * EvidenceDashboard — P-5 Batch 2 Stage 4
 *
 * Admin/operator landing page. Read-only summary data only, with tabs for
 * each operational queue. Mutating actions live on the record detail page
 * and route through Stage 3 RPC wrappers (no direct table writes).
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useP5Batch2Permissions } from "@/hooks/useP5Batch2Permissions";
import { ProviderSafeLabel } from "./components/ProviderSafeLabel";
import type {
  P5B2EvidenceStatus,
  P5B2ProviderStatus,
} from "@/lib/p5-batch2/constants";

type EvidenceItemRow = {
  id: string;
  record_id: string;
  category: string;
  status: P5B2EvidenceStatus;
  rating: string | null;
  expiry_date: string | null;
  provider_dependency: boolean;
  provider_status: P5B2ProviderStatus | null;
  provider_live: boolean;
  current_rejection_reason: string | null;
  updated_at: string;
};

type RecordRow = {
  id: string;
  display_name: string;
  record_type: string;
  is_high_risk: boolean;
};

export const P5B2_DASHBOARD_QUEUES = [
  { key: "gaps", label: "Evidence gaps" },
  { key: "review", label: "Review queue" },
  { key: "provider", label: "Provider-dependent" },
  { key: "expiry", label: "Expiry" },
  { key: "rejected", label: "Rejected" },
  { key: "bank", label: "Bank-detail changes" },
  { key: "ubo", label: "UBO / high-risk" },
] as const;

type QueueKey = (typeof P5B2_DASHBOARD_QUEUES)[number]["key"];

export default function EvidenceDashboard() {
  const perms = useP5Batch2Permissions();
  const [items, setItems] = useState<EvidenceItemRow[]>([]);
  const [records, setRecords] = useState<Record<string, RecordRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!perms.canViewDashboard) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: rows, error: e1 } = await supabase
          .from("p5_batch2_evidence_items")
          .select("id, record_id, category, status, rating, expiry_date, provider_dependency, provider_status, provider_live, current_rejection_reason, updated_at")
          .order("updated_at", { ascending: false })
          .limit(500);
        if (e1) throw e1;
        const recordIds = Array.from(new Set((rows ?? []).map((r) => r.record_id)));
        const recMap: Record<string, RecordRow> = {};
        if (recordIds.length) {
          const { data: recs } = await supabase
            .from("p5_batch2_kyc_records")
            .select("id, display_name, record_type, is_high_risk")
            .in("id", recordIds);
          for (const r of recs ?? []) recMap[r.id] = r as RecordRow;
        }
        if (cancelled) return;
        setItems((rows ?? []) as EvidenceItemRow[]);
        setRecords(recMap);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [perms.canViewDashboard]);

  const byQueue = useMemo(() => {
    const now = Date.now();
    const within30 = (d: string | null) =>
      d ? new Date(d).getTime() - now < 30 * 86400_000 : false;
    return {
      gaps: items.filter((i) => i.status === "missing" || i.status === "requested"),
      review: items.filter((i) => i.status === "uploaded" || i.status === "under_review"),
      provider: items.filter((i) => i.provider_dependency),
      expiry: items.filter((i) => within30(i.expiry_date) || i.status === "expired"),
      rejected: items.filter((i) => i.status === "rejected"),
      bank: items.filter((i) => i.category === "bank"),
      ubo: items.filter((i) => {
        const r = records[i.record_id];
        return r?.is_high_risk || i.category === "ownership" || r?.record_type === "ubo_controller";
      }),
    } as Record<QueueKey, EvidenceItemRow[]>;
  }, [items, records]);

  if (!perms.canViewDashboard) {
    return (
      <div className="p-6">
        <Card>
          <CardHeader><CardTitle>Access denied</CardTitle></CardHeader>
          <CardContent>
            You do not have permission to view the P-5 Batch 2 evidence dashboard.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="p5b2-evidence-dashboard">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Evidence & Artefacts</h1>
        <Badge variant="outline">Role: {perms.category}</Badge>
      </div>
      {error && (
        <Card><CardContent className="pt-6 text-destructive">{error}</CardContent></Card>
      )}
      <Tabs defaultValue="gaps">
        <TabsList className="flex-wrap">
          {P5B2_DASHBOARD_QUEUES.map((q) => (
            <TabsTrigger key={q.key} value={q.key} data-testid={`queue-tab-${q.key}`}>
              {q.label} ({byQueue[q.key].length})
            </TabsTrigger>
          ))}
        </TabsList>
        {P5B2_DASHBOARD_QUEUES.map((q) => (
          <TabsContent key={q.key} value={q.key}>
            <Card>
              <CardHeader><CardTitle>{q.label}</CardTitle></CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-muted-foreground">Loading…</p>
                ) : byQueue[q.key].length === 0 ? (
                  <p className="text-muted-foreground">Queue is empty.</p>
                ) : (
                  <ul className="divide-y">
                    {byQueue[q.key].slice(0, 50).map((item) => (
                      <li key={item.id} className="py-2 flex items-center justify-between">
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">
                            {records[item.record_id]?.display_name ?? "Unknown record"} · {item.category}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Status: {item.status} · Rating: {item.rating ?? "—"} ·{" "}
                            <ProviderSafeLabel
                              provider_status={item.provider_status}
                              provider_live={item.provider_live}
                              viewer="admin"
                            />
                          </p>
                        </div>
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/admin/p5-batch2/records/${item.record_id}`}>Open</Link>
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
