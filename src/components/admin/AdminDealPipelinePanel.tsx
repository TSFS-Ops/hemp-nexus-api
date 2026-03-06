import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, ArrowRight, CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";

interface PipelineOrg {
  org_id: string;
  org_name: string;
  entity_count: number;
  ubo_verified: boolean;
  atb_verified: boolean;
  dd_risk_band: string | null;
  trade_approved: boolean;
  trade_valid: boolean;
  approval_expiry: string | null;
  collapse_count: number;
  poi_states: Record<string, number>;
}

const PIPELINE_STAGES = [
  { key: "entities", label: "Entities" },
  { key: "ubo", label: "UBO" },
  { key: "atb", label: "ATB" },
  { key: "dd", label: "Due Diligence" },
  { key: "approval", label: "Trade Approval" },
  { key: "collapse", label: "Collapse" },
] as const;

function StageIndicator({ passed, label }: { passed: boolean | null; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center border-2 ${
        passed === true ? "bg-emerald-500/10 border-emerald-500 text-emerald-700" :
        passed === false ? "bg-destructive/10 border-destructive text-destructive" :
        "bg-muted border-muted-foreground/30 text-muted-foreground"
      }`}>
        {passed === true ? <CheckCircle className="h-4 w-4" /> :
         passed === false ? <XCircle className="h-4 w-4" /> :
         <Clock className="h-4 w-4" />}
      </div>
      <span className="text-[10px] text-muted-foreground text-center leading-tight">{label}</span>
    </div>
  );
}

export function AdminDealPipelinePanel() {
  const [pipelines, setPipelines] = useState<PipelineOrg[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPipeline = async () => {
    setLoading(true);
    try {
      // Fetch all orgs
      const { data: orgs } = await supabase.from("organizations").select("id, name").order("name").limit(500);
      if (!orgs) return;

      // Parallel fetch of all related data — with limits to prevent full table scans
      const [entitiesRes, uboRes, atbRes, ddRes, approvalsRes, collapseRes, matchesRes] = await Promise.all([
        supabase.from("entities").select("org_id, id").eq("status", "active").limit(2000),
        supabase.from("ubo_links").select("org_id, company_entity_id, ownership_percentage, status").limit(2000),
        supabase.from("authority_records").select("org_id, status").limit(2000),
        supabase.from("dd_risk_scores").select("org_id, risk_band").order("computed_at", { ascending: false }).limit(1000),
        supabase.from("trade_approvals").select("org_id, status, valid_until").limit(1000),
        supabase.from("collapse_ledger").select("org_id, id").limit(2000),
        supabase.from("matches").select("org_id, poi_state").limit(2000),
      ]);

      // Build lookup maps
      const entityCounts = new Map<string, number>();
      (entitiesRes.data || []).forEach((e: any) => {
        entityCounts.set(e.org_id, (entityCounts.get(e.org_id) || 0) + 1);
      });

      const uboVerified = new Map<string, boolean>();
      const uboByOrg = new Map<string, any[]>();
      (uboRes.data || []).forEach((u: any) => {
        if (!uboByOrg.has(u.org_id)) uboByOrg.set(u.org_id, []);
        uboByOrg.get(u.org_id)!.push(u);
      });
      uboByOrg.forEach((links, orgId) => {
        const verified = links.filter((l: any) => l.status === "verified");
        const totalPct = verified.reduce((sum: number, l: any) => sum + Number(l.ownership_percentage), 0);
        uboVerified.set(orgId, totalPct >= 100);
      });

      const atbVerified = new Map<string, boolean>();
      (atbRes.data || []).forEach((a: any) => {
        if (a.status === "verified") atbVerified.set(a.org_id, true);
      });

      const ddRisk = new Map<string, string>();
      (ddRes.data || []).forEach((d: any) => {
        if (!ddRisk.has(d.org_id)) ddRisk.set(d.org_id, d.risk_band);
      });

      const approvals = new Map<string, { status: string; valid_until: string | null }>();
      (approvalsRes.data || []).forEach((a: any) => {
        approvals.set(a.org_id, { status: a.status, valid_until: a.valid_until });
      });

      const collapseCounts = new Map<string, number>();
      (collapseRes.data || []).forEach((c: any) => {
        collapseCounts.set(c.org_id, (collapseCounts.get(c.org_id) || 0) + 1);
      });

      const poiStates = new Map<string, Record<string, number>>();
      (matchesRes.data || []).forEach((m: any) => {
        if (!poiStates.has(m.org_id)) poiStates.set(m.org_id, {});
        const states = poiStates.get(m.org_id)!;
        states[m.poi_state] = (states[m.poi_state] || 0) + 1;
      });

      // Build pipeline
      const result: PipelineOrg[] = orgs.map((org) => {
        const approval = approvals.get(org.id);
        const isApproved = approval?.status === "approved";
        const isValid = isApproved && (!approval?.valid_until || new Date(approval.valid_until) > new Date());

        return {
          org_id: org.id,
          org_name: org.name,
          entity_count: entityCounts.get(org.id) || 0,
          ubo_verified: uboVerified.get(org.id) || false,
          atb_verified: atbVerified.get(org.id) || false,
          dd_risk_band: ddRisk.get(org.id) || null,
          trade_approved: isApproved,
          trade_valid: isValid,
          approval_expiry: approval?.valid_until || null,
          collapse_count: collapseCounts.get(org.id) || 0,
          poi_states: poiStates.get(org.id) || {},
        };
      });

      // Sort: orgs with more pipeline progress first
      result.sort((a, b) => {
        const scoreA = (a.entity_count > 0 ? 1 : 0) + (a.ubo_verified ? 1 : 0) + (a.atb_verified ? 1 : 0) + (a.dd_risk_band ? 1 : 0) + (a.trade_valid ? 1 : 0) + (a.collapse_count > 0 ? 1 : 0);
        const scoreB = (b.entity_count > 0 ? 1 : 0) + (b.ubo_verified ? 1 : 0) + (b.atb_verified ? 1 : 0) + (b.dd_risk_band ? 1 : 0) + (b.trade_valid ? 1 : 0) + (b.collapse_count > 0 ? 1 : 0);
        return scoreB - scoreA;
      });

      setPipelines(result);
    } catch (err) {
      console.error("Pipeline fetch error:", err);
      toast.error("Failed to load pipeline data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPipeline(); }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const globalStats = {
    collapseReady: pipelines.filter((p) => p.trade_valid).length,
    needsAttention: pipelines.filter((p) => p.entity_count > 0 && !p.trade_valid).length,
    totalCollapses: pipelines.reduce((sum, p) => sum + p.collapse_count, 0),
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Deal Pipeline</h2>
          <p className="text-muted-foreground mt-1">
            End-to-end status: Entity → UBO → ATB → DD → Trade Approval → Collapse
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchPipeline}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Collapse-Ready Orgs</p>
            <p className="text-2xl font-bold text-emerald-600">{globalStats.collapseReady}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Needs Attention</p>
            <p className="text-2xl font-bold text-amber-600">{globalStats.needsAttention}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <p className="text-xs text-muted-foreground">Total Collapses</p>
            <p className="text-2xl font-bold">{globalStats.totalCollapses}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        {pipelines.map((p) => (
          <Card key={p.org_id}>
            <CardContent className="py-4 px-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-semibold text-sm">{p.org_name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{p.org_id.substring(0, 12)}…</p>
                </div>
                {p.collapse_count > 0 && (
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">
                    {p.collapse_count} collapse{p.collapse_count !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                <StageIndicator passed={p.entity_count > 0} label={`Entities (${p.entity_count})`} />
                <ArrowRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <StageIndicator passed={p.ubo_verified} label="UBO ≥100%" />
                <ArrowRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <StageIndicator passed={p.atb_verified} label="ATB" />
                <ArrowRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <StageIndicator passed={p.dd_risk_band !== null} label={p.dd_risk_band ? `DD: ${p.dd_risk_band}` : "DD"} />
                <ArrowRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <StageIndicator passed={p.trade_valid} label="Approved" />
                <ArrowRight className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                <StageIndicator passed={p.collapse_count > 0 ? true : null} label="Collapse" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
