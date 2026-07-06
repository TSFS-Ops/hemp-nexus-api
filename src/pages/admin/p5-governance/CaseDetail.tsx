/**
 * CaseDetail — Stage 4
 *
 * Headline readiness, governance/compliance/readiness lanes, evidence,
 * provider, audit timeline, and permission-gated action buttons that call
 * Stage 3 RPCs.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { P5StatusBadge } from "./components/P5StatusBadge";
import { EvidenceReviewPanel, type EvidenceItem } from "./components/EvidenceReviewPanel";
import { ProviderDependencyPanel } from "./components/ProviderDependencyPanel";
import { P5AuditTimeline, type P5AuditEvent } from "./components/P5AuditTimeline";
import { HoldDialog } from "./components/dialogs/HoldDialog";
import { WaiverDialog } from "./components/dialogs/WaiverDialog";
import { OverrideDialog } from "./components/dialogs/OverrideDialog";
import { EscalateDialog } from "./components/dialogs/EscalateDialog";
import { RequestMoreInfoDialog } from "./components/dialogs/RequestMoreInfoDialog";
import { RejectDialog } from "./components/dialogs/RejectDialog";
import { useP5Permissions } from "@/hooks/useP5Permissions";
import { p5Rpc } from "@/lib/p5-governance/rpc";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";

type Case = Database["public"]["Tables"]["p5_governance_readiness_cases"]["Row"];

export default function CaseDetail() {
  const { caseId } = useParams<{ caseId: string }>();
  const permissions = useP5Permissions();
  const [c, setCase] = useState<Case | null>(null);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [events, setEvents] = useState<P5AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [dlg, setDlg] = useState<
    "hold" | "waiver" | "override" | "escalate" | "more_info" | "reject" | null
  >(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const [caseRes, evRes, audRes] = await Promise.all([
        supabase.from("p5_governance_readiness_cases").select("*").eq("id", caseId).maybeSingle(),
        supabase
          .from("p5_governance_evidence_items")
          .select("*")
          .eq("case_id", caseId)
          .order("created_at", { ascending: true }),
        supabase
          .from("p5_governance_audit_events")
          .select(
            "id, created_at, event_type, actor_type, actor_user_id, previous_status, new_status, reason_code, note",
          )
          .eq("case_id", caseId)
          .order("created_at", { ascending: false })
          .limit(200),
      ]);
      if (caseRes.error) throw caseRes.error;
      if (evRes.error) throw evRes.error;
      if (audRes.error) throw audRes.error;
      setCase((caseRes.data ?? null) as Case | null);
      setEvidence((evRes.data ?? []) as EvidenceItem[]);
      setEvents((audRes.data ?? []) as P5AuditEvent[]);
    } catch (err) {
      toast.error(
        `Failed to load case: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!permissions.canViewAdmin) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <Card>
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            P-5 Governance is restricted to authorised internal roles.
          </CardContent>
        </Card>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  if (!c) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <BackButton fallback="/admin/p5-governance" />
        <p className="text-sm text-muted-foreground mt-4">Case not found.</p>
      </main>
    );
  }

  const approveInternal = async () => {
    try {
      await p5Rpc.approveInternally({ case_id: c.id });
      toast.success("Approved internally");
      void load();
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const approveReady = async () => {
    const note = window.prompt("Note for Ready-to-Proceed approval (recorded in audit):");
    if (!note || !note.trim()) {
      toast.error("Note is required");
      return;
    }
    try {
      await p5Rpc.approveReadyToProceed({ case_id: c.id, note: note.trim() });
      toast.success("Ready to proceed");
      void load();
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-4">
      <BackButton fallback="/admin/p5-governance" />

      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">P-5 Case</h1>
          <p className="font-mono text-xs text-muted-foreground break-all">{c.id}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Readiness:</span>
          <P5StatusBadge status={c.readiness_status} />
          {c.is_on_hold && <P5StatusBadge status="on_hold" />}
          {c.is_escalated && <P5StatusBadge status="escalated" />}
          {c.waiver_active && <P5StatusBadge status="waived" />}
          {c.override_active && <P5StatusBadge status="override_approved" />}
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Governance lane</CardTitle>
          </CardHeader>
          <CardContent>
            <P5StatusBadge status={c.governance_status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Compliance lane</CardTitle>
          </CardHeader>
          <CardContent>
            <P5StatusBadge status={c.compliance_status} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Readiness lane</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <P5StatusBadge status={c.readiness_status} />
            <div className="text-xs text-muted-foreground mt-2">
              Blockers: <span className="font-mono">{c.blocker_count}</span> · Warnings:{" "}
              <span className="font-mono">{c.warning_count}</span>
            </div>
            {c.next_action && (
              <div className="text-xs">Next action: {c.next_action}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
          <div>Organisation: {c.organization_id ?? "—"}</div>
          <div>Entity: {c.entity_id ?? "—"}</div>
          <div>Match: {c.match_id ?? "—"}</div>
          <div>Trade request: {c.trade_request_id ?? "—"}</div>
          <div>Counterparty: {c.counterparty_id ?? "—"}</div>
          <div>Programme: {c.programme_id ?? "—"}</div>
          <div>Owner: {c.owner_user_id ?? "—"}</div>
          <div>Reviewer: {c.assigned_reviewer_id ?? "—"}</div>
          <div>SLA due: {c.sla_due_at ?? "—"}</div>
          <div>Audit reference: {c.audit_reference ?? "—"}</div>
        </CardContent>
      </Card>

      {permissions.canMutate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2" data-testid="p5-actions">
            {permissions.canRequestMoreInfo && (
              <Button variant="outline" onClick={() => setDlg("more_info")}>
                Request more information
              </Button>
            )}
            {permissions.canApproveInternally && (
              <Button variant="outline" onClick={approveInternal}>
                Approve internally
              </Button>
            )}
            {permissions.canApproveReadyToProceed && (
              <Button onClick={approveReady} data-testid="p5-action-ready">
                Approve ready to proceed
              </Button>
            )}
            {permissions.canApplyHold && (
              <Button variant="outline" onClick={() => setDlg("hold")} data-testid="p5-action-hold">
                Apply hold
              </Button>
            )}
            {permissions.canEscalate && (
              <Button variant="destructive" onClick={() => setDlg("escalate")}>
                Escalate
              </Button>
            )}
            {permissions.canReject && (
              <Button variant="destructive" onClick={() => setDlg("reject")}>
                Reject
              </Button>
            )}
            {permissions.canWaive && (
              <Button variant="destructive" onClick={() => setDlg("waiver")} data-testid="p5-action-waiver">
                Grant waiver
              </Button>
            )}
            {permissions.canOverride && (
              <Button variant="destructive" onClick={() => setDlg("override")} data-testid="p5-action-override">
                Apply override
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <EvidenceReviewPanel items={evidence} permissions={permissions} onChanged={load} />

      <ProviderDependencyPanel
        data={{
          provider_dependency: c.provider_dependency,
          provider_dependency_type: c.provider_dependency_type,
          provider_status: c.provider_status,
          provider_last_checked_at: c.provider_last_checked_at,
          requires_human_review: c.provider_status === "inconclusive",
        }}
      />

      {permissions.canViewAuditTimeline && <P5AuditTimeline events={events} />}

      <HoldDialog
        open={dlg === "hold"}
        onOpenChange={(v) => setDlg(v ? "hold" : null)}
        caseId={c.id}
        onDone={load}
      />
      <WaiverDialog
        open={dlg === "waiver"}
        onOpenChange={(v) => setDlg(v ? "waiver" : null)}
        caseId={c.id}
        onDone={load}
      />
      <OverrideDialog
        open={dlg === "override"}
        onOpenChange={(v) => setDlg(v ? "override" : null)}
        caseId={c.id}
        onDone={load}
      />
      <EscalateDialog
        open={dlg === "escalate"}
        onOpenChange={(v) => setDlg(v ? "escalate" : null)}
        caseId={c.id}
        onDone={load}
      />
      <RequestMoreInfoDialog
        open={dlg === "more_info"}
        onOpenChange={(v) => setDlg(v ? "more_info" : null)}
        caseId={c.id}
        onDone={load}
      />
      <RejectDialog
        open={dlg === "reject"}
        onOpenChange={(v) => setDlg(v ? "reject" : null)}
        caseId={c.id}
        onDone={load}
      />
    </main>
  );
}
