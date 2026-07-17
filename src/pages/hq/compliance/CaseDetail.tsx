/**
 * Compliance Case Detail — the internal workbench case file.
 *
 * One coherent page with tabbed sections covering the approved case file:
 * Overview, Subjects, Evidence, Providers, Risk, RFIs, Tasks, Notes,
 * Customer Messages, Escalations, Decision, Approvals, Holds, Timeline,
 * Exports.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CaseHeader, CWStatusBadge } from "@/components/compliance-workbench";
import {
  getCaseDetail,
  type CaseDetail as CaseDetailT,
  COMPLIANCE_SENDER_NAME,
  DECISION_OUTCOME_LABELS,
  NOTE_TYPE_LABELS,
  PROVIDER_KIND_LABELS,
  SLA_POLICY,
} from "@/lib/compliance-workbench";
import { formatDate, formatDateTime, relativeFromNow } from "@/lib/funder-workspace/ui/labels";

const TABS = [
  "overview",
  "subjects",
  "evidence",
  "providers",
  "risk",
  "rfis",
  "tasks",
  "notes",
  "messages",
  "escalations",
  "decision",
  "approvals",
  "holds",
  "timeline",
  "exports",
] as const;

export default function ComplianceCaseDetail() {
  const { reference = "" } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<CaseDetailT | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setError(null);
    getCaseDetail(reference)
      .then((d) => alive && setDetail(d))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [reference]);

  if (error) {
    return (
      <Card className="p-6" role="alert">
        <div className="flex items-start gap-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
          <div>
            <div className="font-medium text-destructive">Cannot load case</div>
            <div className="text-muted-foreground">{error}</div>
          </div>
        </div>
      </Card>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28" />
        <Skeleton className="h-8 w-96" />
        <Skeleton className="h-72" />
      </div>
    );
  }

  const d = detail;
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
      </Button>
      <CaseHeader summary={d.summary} />

      <Tabs defaultValue="overview" className="w-full">
        <div className="overflow-x-auto">
          <TabsList className="inline-flex">
            {TABS.map((t) => (
              <TabsTrigger key={t} value={t} className="capitalize">
                {tabLabel(t)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab d={d} />
        </TabsContent>

        <TabsContent value="subjects" className="mt-4">
          <SubjectsTab d={d} />
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <EvidenceTab d={d} />
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          <ProvidersTab d={d} />
        </TabsContent>

        <TabsContent value="risk" className="mt-4">
          <RiskTab d={d} />
        </TabsContent>

        <TabsContent value="rfis" className="mt-4">
          <RfisTab d={d} />
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          <TasksTab d={d} />
        </TabsContent>

        <TabsContent value="notes" className="mt-4">
          <NotesTab d={d} kind="internal" />
        </TabsContent>

        <TabsContent value="messages" className="mt-4">
          <NotesTab d={d} kind="customer" />
        </TabsContent>

        <TabsContent value="escalations" className="mt-4">
          <EscalationsTab d={d} />
        </TabsContent>

        <TabsContent value="decision" className="mt-4">
          <DecisionTab d={d} />
        </TabsContent>

        <TabsContent value="approvals" className="mt-4">
          <ApprovalsTab d={d} />
        </TabsContent>

        <TabsContent value="holds" className="mt-4">
          <HoldsTab d={d} />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <TimelineTab d={d} />
        </TabsContent>

        <TabsContent value="exports" className="mt-4">
          <ExportsTab d={d} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function tabLabel(t: (typeof TABS)[number]) {
  switch (t) {
    case "overview": return "Overview";
    case "subjects": return "Subjects";
    case "evidence": return "Evidence";
    case "providers": return "Providers";
    case "risk": return "Risk";
    case "rfis": return "RFIs";
    case "tasks": return "Tasks";
    case "notes": return "Internal Notes";
    case "messages": return "Customer Messages";
    case "escalations": return "Escalations";
    case "decision": return "Decision";
    case "approvals": return "Approvals";
    case "holds": return "Holds";
    case "timeline": return "Timeline";
    case "exports": return "Exports";
  }
}

// ---------- Tabs ----------

function OverviewTab({ d }: { d: CaseDetailT }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Primary subject</div>
        <div className="mt-1 text-sm font-medium">{d.summary.primarySubject.displayName}</div>
        <div className="text-xs text-muted-foreground">
          {d.summary.primarySubject.kind}
          {d.summary.primarySubject.jurisdiction ? ` · ${d.summary.primarySubject.jurisdiction}` : ""}
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Current task</div>
        <div className="mt-1 text-sm font-medium">{d.summary.currentTask ?? "—"}</div>
      </Card>
      <Card className="p-4 md:col-span-2">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Related records</div>
        <ul className="mt-2 space-y-1 text-sm">
          {d.relatedRecords.map((r, i) => (
            <li key={i} className="flex items-center justify-between border-b border-border py-1 last:border-0">
              <span>{r.label}</span>
              <span className="text-muted-foreground">{r.reference}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function SubjectsTab({ d }: { d: CaseDetailT }) {
  return (
    <Card className="divide-y divide-border">
      {d.subjects.map((s, i) => (
        <div key={i} className="grid gap-2 p-4 md:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Subject</div>
            <div className="font-medium">{s.displayName}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Kind</div>
            <div className="capitalize">{s.kind}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Jurisdiction</div>
            <div>{s.jurisdiction ?? "—"}</div>
          </div>
        </div>
      ))}
    </Card>
  );
}

function EvidenceTab({ d }: { d: CaseDetailT }) {
  return (
    <div className="space-y-3">
      {d.evidence.map((ev) => (
        <Card key={ev.id} className="p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="font-medium text-foreground">{ev.requirementLabel}</div>
              <div className="text-xs text-muted-foreground">
                {ev.fileName ? `${ev.fileName} · ` : ""}Version {ev.version} · attempt {ev.attemptsUsed}/{ev.attemptsAllowed}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CWStatusBadge kind="evidence" value={ev.state} />
              {ev.linkedToPack && <span className="rounded bg-primary/10 px-2 py-0.5 text-xs text-primary">In pack</span>}
              {ev.expiresAt && <span className="text-xs text-muted-foreground">expires {formatDate(ev.expiresAt)}</span>}
            </div>
          </div>
          {ev.rejectionReason && (
            <div className="mt-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              Rejected: {ev.rejectionReason}
            </div>
          )}
          {ev.reviewerNotes && (
            <div className="mt-2 text-xs text-muted-foreground">Reviewer note: {ev.reviewerNotes}</div>
          )}
          {ev.history.length > 0 && (
            <details className="mt-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Version history ({ev.history.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {ev.history.map((h, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{h.state}{h.note ? ` — ${h.note}` : ""}</span>
                    <span>{formatDateTime(h.at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      ))}
      {d.evidence.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">No evidence requirements yet.</Card>
      )}
    </div>
  );
}

function ProvidersTab({ d }: { d: CaseDetailT }) {
  return (
    <div className="space-y-3">
      <Card className="p-3 text-xs text-muted-foreground">
        Provider names and raw responses are internal-only. Customer-facing surfaces show only the
        approved public-safe summary.
      </Card>
      {d.providerResults.map((pr) => (
        <Card key={pr.id} className="p-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
            <div>
              <div className="font-medium">{PROVIDER_KIND_LABELS[pr.kind]}</div>
              <div className="text-xs text-muted-foreground">
                {pr.providerLabel} · requested {formatDateTime(pr.requestedAt)}
                {pr.receivedAt ? ` · received ${formatDateTime(pr.receivedAt)}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CWStatusBadge kind="provider" value={pr.state} />
              {pr.manuallyReviewed && <span className="text-xs text-muted-foreground">Manually reviewed</span>}
              {pr.expiresAt && <span className="text-xs text-muted-foreground">expires {formatDate(pr.expiresAt)}</span>}
            </div>
          </div>
          <div className="mt-2 text-sm">{pr.publicSafeSummary}</div>
        </Card>
      ))}
    </div>
  );
}

function RiskTab({ d }: { d: CaseDetailT }) {
  if (!d.risk) return <Card className="p-6 text-sm text-muted-foreground">No risk snapshot yet.</Card>;
  const r = d.risk;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Score</div>
        <div className="mt-1 text-3xl font-semibold">{r.score ?? "—"}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Band</div>
        <div className="mt-1">
          <CWStatusBadge kind="risk" value={r.band ?? undefined} />
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Calculated</div>
        <div className="mt-1 text-sm">{formatDateTime(r.calculatedAt)}</div>
        <div className="text-xs text-muted-foreground">Version {r.calculationVersion}</div>
      </Card>
      <Card className="p-4 md:col-span-3">
        <div className="text-sm font-medium">Contribution</div>
        <ul className="mt-2 space-y-1 text-sm">
          {r.factors.map((f) => (
            <li key={f.key} className="flex justify-between border-b border-border py-1 last:border-0">
              <span>{f.label}</span>
              <span className="tabular-nums text-muted-foreground">+{f.contribution}</span>
            </li>
          ))}
        </ul>
        {r.overrideActive && (
          <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
            Override active — expires {formatDate(r.overrideExpiresAt)}. {r.overrideReason}
          </div>
        )}
      </Card>
    </div>
  );
}

function RfisTab({ d }: { d: CaseDetailT }) {
  if (d.rfis.length === 0) return <Card className="p-6 text-sm text-muted-foreground">No open RFIs.</Card>;
  return (
    <div className="space-y-3">
      <Card className="p-3 text-xs text-muted-foreground">
        Policy: {SLA_POLICY.rfi_response_business_days} business days · reminders at 50/80/100% ·
        maximum {SLA_POLICY.rfi_max_standard_cycles} standard cycles ·
        final {SLA_POLICY.rfi_final_notice_business_days}-day notice on non-response.
      </Card>
      {d.rfis.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="font-mono text-xs text-muted-foreground">{r.reference}</div>
              <div className="text-sm">
                Cycle {r.cycleNumber} · issued {formatDate(r.issuedAt)} · due {formatDate(r.dueAt)} ({relativeFromNow(r.dueAt)})
              </div>
            </div>
            <div className="flex gap-2">
              {r.awaitingCustomer && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">Awaiting customer</span>}
              {r.overdue && <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Overdue</span>}
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {r.items.map((it) => (
              <li key={it.id} className="rounded border border-border p-2">
                <div className="text-xs uppercase text-muted-foreground">{it.category} · {it.requestedItemType}</div>
                <div className="text-sm">{it.customerSafeText}</div>
                <div className="mt-1 text-xs text-muted-foreground">Internal reason: {it.internalReason}</div>
                <div className="mt-1 text-xs">State: <span className="font-medium">{it.state}</span></div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function TasksTab({ d }: { d: CaseDetailT }) {
  return (
    <Card className="divide-y divide-border">
      {d.tasks.length === 0 && <div className="p-6 text-sm text-muted-foreground">No open tasks.</div>}
      {d.tasks.map((t) => (
        <div key={t.id} className="flex items-center justify-between p-3 text-sm">
          <div>
            <div className={t.done ? "line-through text-muted-foreground" : "font-medium"}>{t.title}</div>
            <div className="text-xs text-muted-foreground">
              {t.ownerDisplayName ?? "Unassigned"} · due {formatDate(t.dueAt)}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

function NotesTab({ d, kind }: { d: CaseDetailT; kind: "internal" | "customer" }) {
  const items = kind === "customer" ? d.customerMessages : d.notes;
  if (items.length === 0) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {kind === "customer" ? "No customer messages yet." : "No internal notes yet."}
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {items.map((n) => (
        <Card key={n.id} className="p-3">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{n.authorDisplayName}</span> · {n.authorRole}
            </span>
            <span>{formatDateTime(n.createdAt)}</span>
          </div>
          <div className="mt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
            {NOTE_TYPE_LABELS[n.type]}
          </div>
          <div className="mt-1 text-sm">{n.body}</div>
        </Card>
      ))}
      {kind === "customer" && (
        <div className="text-xs text-muted-foreground">
          Messages are sent from {COMPLIANCE_SENDER_NAME}. Individual analyst names are never
          shown to customers.
        </div>
      )}
    </div>
  );
}

function EscalationsTab({ d }: { d: CaseDetailT }) {
  if (d.escalations.length === 0)
    return <Card className="p-6 text-sm text-muted-foreground">No escalations.</Card>;
  return (
    <Card className="divide-y divide-border">
      {d.escalations.map((e) => (
        <div key={e.id} className="p-3 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">Level {e.level}</span>
            <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
          </div>
          <div className="text-muted-foreground">{e.reason}</div>
          <div className="text-xs text-muted-foreground">Owner: {e.ownerDisplayName}</div>
        </div>
      ))}
    </Card>
  );
}

function DecisionTab({ d }: { d: CaseDetailT }) {
  return (
    <div className="space-y-3">
      {d.decisions.length === 0 && (
        <Card className="p-6 text-sm text-muted-foreground">
          No final decision recorded. A decision is created only once all required distinct
          approvers have completed their actions.
        </Card>
      )}
      {d.decisions.map((dc) => (
        <Card key={dc.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Version {dc.version}
                {dc.supersededByVersion ? ` · superseded by v${dc.supersededByVersion}` : ""}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <CWStatusBadge kind="decision" value={dc.outcome} />
                <span className="text-sm">{DECISION_OUTCOME_LABELS[dc.outcome]}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Decided {formatDateTime(dc.decidedAt)} by {dc.decidedByDisplayName}
              </div>
            </div>
          </div>
          <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Customer-safe rationale</div>
              <div>{dc.rationaleCustomerSafe}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Internal rationale</div>
              <div>{dc.rationaleInternal}</div>
            </div>
          </div>
          {dc.conditions.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-muted-foreground">Conditions</div>
              <ul className="mt-1 space-y-1 text-sm">
                {dc.conditions.map((c) => (
                  <li key={c.id} className="rounded border border-border p-2">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">
                      Owner: {c.ownerRole} · due {formatDate(c.dueAt)} · expires {formatDate(c.expiresAt)} ·
                      monitoring {c.monitoringFrequency}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function ApprovalsTab({ d }: { d: CaseDetailT }) {
  if (d.approvals.length === 0)
    return <Card className="p-6 text-sm text-muted-foreground">No proposals awaiting approval.</Card>;
  return (
    <div className="space-y-3">
      {d.approvals.map((ap) => (
        <Card key={ap.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase text-muted-foreground">Proposal</div>
              <div className="mt-1 flex items-center gap-2">
                <CWStatusBadge kind="decision" value={ap.proposedOutcome} />
                <span className="text-sm">{DECISION_OUTCOME_LABELS[ap.proposedOutcome]}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Proposed by {ap.proposedByDisplayName} · {formatDateTime(ap.proposedAt)}
              </div>
            </div>
            {ap.emergencyBypass && (
              <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Emergency bypass</span>
            )}
            {ap.invalidated && (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                Invalidated by new evidence
              </span>
            )}
          </div>
          <div className="mt-3">
            <div className="text-xs font-medium text-muted-foreground">Required approvers</div>
            <ul className="mt-1 space-y-1 text-sm">
              {ap.requirements.map((rq, i) => {
                const conflict = ap.proposedByDisplayName === rq.actedByDisplayName;
                return (
                  <li key={i} className="flex items-center justify-between rounded border border-border p-2">
                    <span className="font-medium">{rq.roleLabel}</span>
                    <span className="flex items-center gap-2">
                      <span className={statusToneClass(rq.status)}>{rq.status}</span>
                      {rq.actedByDisplayName && (
                        <span className="text-xs text-muted-foreground">by {rq.actedByDisplayName}</span>
                      )}
                      {conflict && (
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                          Distinct-person conflict
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Card>
      ))}
    </div>
  );
}

function HoldsTab({ d }: { d: CaseDetailT }) {
  if (d.holds.length === 0)
    return <Card className="p-6 text-sm text-muted-foreground">No holds on this case.</Card>;
  return (
    <div className="space-y-3">
      {d.holds.map((h) => (
        <Card key={h.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CWStatusBadge kind="hold" value={h.type} />
              <div className="mt-1 text-xs text-muted-foreground">
                Applied {formatDateTime(h.appliedAt)} by {h.appliedByDisplayName}
              </div>
            </div>
            {h.active ? (
              <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">Active</span>
            ) : (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">Released</span>
            )}
          </div>
          <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Internal reason</div>
              <div>{h.reasonInternal}</div>
            </div>
            <div>
              <div className="text-xs font-medium text-muted-foreground">Customer-safe reason</div>
              <div>{h.reasonCustomerSafe}</div>
            </div>
          </div>
          <div className="mt-2">
            <div className="text-xs font-medium text-muted-foreground">Downstream effects</div>
            <ul className="mt-1 list-inside list-disc text-sm">
              {h.effects.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
          {h.requiresDistinctApprover && (
            <div className="mt-2 text-xs text-muted-foreground">
              Release requires a distinct approver (AAL2, mandatory reason).
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function TimelineTab({ d }: { d: CaseDetailT }) {
  return (
    <Card className="divide-y divide-border">
      {d.timeline.map((e) => (
        <div key={e.id} className="grid gap-1 p-3 text-sm md:grid-cols-[180px_auto_1fr]">
          <span className="text-xs text-muted-foreground">{formatDateTime(e.at)}</span>
          <span className="font-mono text-xs">
            {e.kind}
            {e.customerVisible && (
              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary">customer</span>
            )}
          </span>
          <span>
            {e.summary} <span className="text-xs text-muted-foreground">— {e.actorDisplayName ?? "System"}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}

function ExportsTab({ d }: { d: CaseDetailT }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {d.exports.map((ex) => (
        <Card key={ex.id} className="p-4">
          <div className="text-xs uppercase text-muted-foreground">
            {ex.audience === "internal" ? "Internal / Auditor bundle" : ex.audience === "customer" ? "Customer bundle" : "Funder bundle"}
          </div>
          <div className="mt-1 text-sm">Version {ex.version}</div>
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            <li>Generated: {ex.generatedAt ? formatDateTime(ex.generatedAt) : "not generated"}</li>
            <li>Expires: {ex.expiresAt ? formatDate(ex.expiresAt) : "—"}</li>
            <li>Watermark: {ex.watermarkApplied ? "applied" : "n/a"}</li>
            <li>Seal hash: {ex.sealHashPresent ? "present" : "not yet"}</li>
            <li>Approval: {ex.approvalRequired ? "required" : "not required"}{ex.approvedByDisplayName ? ` · by ${ex.approvedByDisplayName}` : ""}</li>
          </ul>
          <div className="mt-3 text-xs text-muted-foreground">
            {ex.downloadAvailable
              ? "Download available."
              : "Awaiting secure backend enablement — download not available."}
          </div>
        </Card>
      ))}
    </div>
  );
}

function statusToneClass(s: string) {
  if (s === "approved") return "text-emerald-700 dark:text-emerald-400";
  if (s === "rejected") return "text-destructive";
  return "text-amber-700 dark:text-amber-400";
}
