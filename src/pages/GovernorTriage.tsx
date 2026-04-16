import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ShieldCheck,
  AlertTriangle,
  Inbox,
  Archive,
  FileSearch,
  Gavel,
  Check,
  X,
  Flag,
  Clock,
  User,
  Building2,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";
type CaseStatus = "open" | "escalated" | "resolved";

const NAV_ITEMS = [
  { href: "/governor", label: "Triage Inbox", icon: Inbox, count: 14 },
  { href: "/governor/escalated", label: "Escalated", icon: AlertTriangle, count: 3 },
  { href: "/governor/audit", label: "Audit Trail", icon: FileSearch },
  { href: "/governor/policies", label: "Policy Engine", icon: Gavel },
  { href: "/governor/archive", label: "Archive", icon: Archive },
];

interface ReviewCase {
  id: string;
  reference: string;
  subject: string;
  org: string;
  counterparty: string;
  severity: Severity;
  status: CaseStatus;
  trigger: string;
  flaggedAt: string;
  amount: string;
  jurisdiction: string;
  riskScore: number;
  factors: { label: string; value: string; flag?: boolean }[];
  evidence: { type: string; ref: string; hash: string }[];
  notes: { actor: string; role: string; at: string; text: string }[];
}

const CASES: ReviewCase[] = [
  {
    id: "case_01",
    reference: "CR-2025-0418-001",
    subject: "Sanctions list match — UBO secondary screen",
    org: "Acme Trading Pty Ltd",
    counterparty: "Northbound Refining Ltd",
    severity: "critical",
    status: "open",
    trigger: "dilisense.match",
    flaggedAt: "14:02:45 SAST",
    amount: "USD 2,384,500",
    jurisdiction: "ZA → CH",
    riskScore: 87,
    factors: [
      { label: "Sanctions hit (UBO)", value: "1 of 3", flag: true },
      { label: "PEP exposure", value: "0", flag: false },
      { label: "Adverse media", value: "2 sources", flag: true },
      { label: "Jurisdiction risk", value: "Medium", flag: false },
      { label: "Behavioural anomaly", value: "None", flag: false },
    ],
    evidence: [
      { type: "Dilisense report", ref: "dlr_9f3aB2cD7e", hash: "sha256:7Hq2X9…" },
      { type: "UBO declaration", ref: "ubo_4kL8mN2pQ", hash: "sha256:3mP9qR…" },
      { type: "Trade Request", ref: "tr_xK9j2nP4Rt", hash: "sha256:8tFp1Z…" },
    ],
    notes: [
      {
        actor: "System",
        role: "automation",
        at: "14:02:45",
        text: "Auto-flagged: secondary UBO matched OFAC SDN list (confidence 0.91).",
      },
      {
        actor: "L. Dlamini",
        role: "Compliance Analyst",
        at: "14:18:02",
        text: "Verified against source list. Match appears genuine, escalating to Governor for review.",
      },
    ],
  },
  {
    id: "case_02",
    reference: "CR-2025-0418-002",
    subject: "Threshold breach — single trade exceeds R10M tier",
    org: "Karoo Minerals (Pty) Ltd",
    counterparty: "Helios Bullion DMCC",
    severity: "high",
    status: "open",
    trigger: "approval.threshold_exceeded",
    flaggedAt: "13:54:11 SAST",
    amount: "USD 14,200,000",
    jurisdiction: "ZA → AE",
    riskScore: 64,
    factors: [
      { label: "Sanctions hit", value: "0", flag: false },
      { label: "Threshold tier", value: "Director (>R10M)", flag: true },
      { label: "Counterparty age", value: "47 days", flag: true },
      { label: "Jurisdiction risk", value: "High (AE)", flag: true },
    ],
    evidence: [
      { type: "Approval request", ref: "ar_3mP9qR1sT", hash: "sha256:2Fz1N5…" },
      { type: "Risk score", ref: "rs_9Tk4M6Yc8Q", hash: "sha256:7Hq2X9…" },
    ],
    notes: [],
  },
  {
    id: "case_03",
    reference: "CR-2025-0418-003",
    subject: "Document mismatch — UBO declaration vs registry",
    org: "Veld Commodities",
    counterparty: "Blackrock Resources SA",
    severity: "medium",
    status: "open",
    trigger: "idv.registry_mismatch",
    flaggedAt: "13:31:02 SAST",
    amount: "USD 480,000",
    jurisdiction: "ZA → ZA",
    riskScore: 41,
    factors: [
      { label: "Registry match", value: "Partial (87%)", flag: true },
      { label: "Document age", value: "9 days", flag: false },
    ],
    evidence: [
      { type: "CIPC extract", ref: "idv_2Fz1N5Jb7P", hash: "sha256:4kL8mN…" },
    ],
    notes: [],
  },
  {
    id: "case_04",
    reference: "CR-2025-0418-004",
    subject: "Behavioural anomaly — rapid POI cancellations",
    org: "Sundown Trading Co",
    counterparty: "—",
    severity: "medium",
    status: "open",
    trigger: "behavioural.anomaly",
    flaggedAt: "12:48:33 SAST",
    amount: "—",
    jurisdiction: "ZA",
    riskScore: 38,
    factors: [
      { label: "POI cancellations (24h)", value: "7", flag: true },
      { label: "Engagement score", value: "22 / 100", flag: true },
    ],
    evidence: [],
    notes: [],
  },
  {
    id: "case_05",
    reference: "CR-2025-0418-005",
    subject: "Manual review requested — counterparty onboarding",
    org: "Cape Refining Holdings",
    counterparty: "Aurum Trade House",
    severity: "low",
    status: "open",
    trigger: "manual.request",
    flaggedAt: "11:22:18 SAST",
    amount: "USD 95,000",
    jurisdiction: "ZA → GB",
    riskScore: 19,
    factors: [{ label: "Compliance request", value: "Voluntary", flag: false }],
    evidence: [],
    notes: [],
  },
  {
    id: "case_06",
    reference: "CR-2025-0418-006",
    subject: "WaD seal — pre-issuance gate verification",
    org: "Acme Trading Pty Ltd",
    counterparty: "Helios Bullion DMCC",
    severity: "high",
    status: "open",
    trigger: "wad.gate_check",
    flaggedAt: "10:55:07 SAST",
    amount: "USD 1,820,000",
    jurisdiction: "ZA → AE",
    riskScore: 58,
    factors: [{ label: "WaD gates pending", value: "2 of 9", flag: true }],
    evidence: [],
    notes: [],
  },
];

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "text-destructive bg-destructive/5 border-destructive/30",
  high: "text-warning-foreground bg-warning/15 border-warning/40",
  medium: "text-foreground bg-secondary border-border",
  low: "text-muted-foreground bg-secondary border-border",
};

function SeverityPill({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center font-mono text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border",
        SEVERITY_STYLES[severity],
      )}
    >
      {severity}
    </span>
  );
}

function RiskMeter({ score }: { score: number }) {
  const tone =
    score >= 75
      ? "bg-destructive"
      : score >= 50
      ? "bg-warning"
      : score >= 25
      ? "bg-foreground/60"
      : "bg-emerald";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 bg-secondary rounded-full overflow-hidden border border-border">
        <div className={cn("h-full", tone)} style={{ width: `${score}%` }} />
      </div>
      <span className="font-mono text-[12px] tabular-nums text-foreground">
        {score}
      </span>
    </div>
  );
}

export default function GovernorTriage() {
  const location = useLocation();
  const [selectedId, setSelectedId] = useState(CASES[0].id);
  const [tab, setTab] = useState<"summary" | "evidence" | "notes">("summary");

  const selected = CASES.find((c) => c.id === selectedId) ?? CASES[0];

  return (
    <div className="min-h-screen-safe bg-background flex">
      {/* Governor sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-secondary/40 flex flex-col">
        <div className="h-14 flex items-center gap-2 px-5 border-b border-border">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-semibold text-foreground tracking-tight">
            governor
          </span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active =
              item.href === "/governor" || location.pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors",
                  active
                    ? "bg-background text-foreground border border-border font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60",
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {item.count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border space-y-1">
          <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">
            ROLE: <span className="text-foreground">Governor</span>
            <br />
            SLA: <span className="text-foreground">4h critical / 24h std</span>
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto px-8 py-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-foreground">Triage Inbox</h1>
              <p className="text-sm text-muted-foreground mt-1.5">
                Review and adjudicate flagged compliance cases.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-3 mr-2 text-xs font-mono text-muted-foreground">
                <span>
                  CRITICAL <span className="text-destructive">1</span>
                </span>
                <span>
                  HIGH <span className="text-foreground">2</span>
                </span>
                <span>
                  OPEN <span className="text-foreground">14</span>
                </span>
              </div>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Flag className="h-3.5 w-3.5" />
                Filters
              </Button>
            </div>
          </div>

          {/* Split-pane container */}
          <div className="border border-border rounded-md overflow-hidden bg-background flex h-[680px]">
            {/* LEFT — Case Queue */}
            <div className="w-[38%] border-r border-border flex flex-col min-w-0">
              <div className="h-10 flex items-center px-4 border-b border-border bg-secondary">
                <span className="text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
                  Case Queue
                </span>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">
                  {CASES.length} open
                </span>
              </div>
              <ul className="flex-1 overflow-y-auto">
                {CASES.map((c) => {
                  const active = c.id === selectedId;
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => {
                          setSelectedId(c.id);
                          setTab("summary");
                        }}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b border-border transition-colors flex flex-col gap-1.5 border-l-2",
                          active
                            ? "bg-secondary border-l-primary"
                            : "border-l-transparent hover:bg-secondary/50",
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <SeverityPill severity={c.severity} />
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums ml-auto">
                            {c.flaggedAt}
                          </span>
                        </div>
                        <p className="text-[13px] text-foreground font-medium leading-snug">
                          {c.subject}
                        </p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="font-mono">{c.reference}</span>
                          <span>·</span>
                          <span className="truncate">{c.org}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* RIGHT — Case Detail */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Detail header */}
              <div className="px-5 py-4 border-b border-border bg-secondary/50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <SeverityPill severity={selected.severity} />
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {selected.reference}
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        ·
                      </span>
                      <span className="font-mono text-[11px] text-foreground">
                        {selected.trigger}
                      </span>
                    </div>
                    <h2 className="text-foreground leading-snug">
                      {selected.subject}
                    </h2>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Building2 className="h-3 w-3" />
                        {selected.org}
                      </span>
                      <ChevronRight className="h-3 w-3" />
                      <span>{selected.counterparty}</span>
                      <span className="font-mono ml-auto">
                        {selected.jurisdiction}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Summary metric strip */}
                <div className="grid grid-cols-3 gap-px bg-border mt-4 border border-border rounded-md overflow-hidden">
                  <div className="bg-background px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Exposure
                    </p>
                    <p className="font-mono text-[13px] text-foreground mt-0.5 tabular-nums">
                      {selected.amount}
                    </p>
                  </div>
                  <div className="bg-background px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Risk Score
                    </p>
                    <div className="mt-1">
                      <RiskMeter score={selected.riskScore} />
                    </div>
                  </div>
                  <div className="bg-background px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Flagged
                    </p>
                    <p className="font-mono text-[13px] text-foreground mt-0.5 tabular-nums flex items-center gap-1.5">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {selected.flaggedAt}
                    </p>
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border bg-background px-2">
                {(
                  [
                    { id: "summary" as const, label: "Risk Factors" },
                    {
                      id: "evidence" as const,
                      label: `Evidence (${selected.evidence.length})`,
                    },
                    {
                      id: "notes" as const,
                      label: `Notes (${selected.notes.length})`,
                    },
                  ]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px",
                      tab === t.id
                        ? "text-foreground border-foreground"
                        : "text-muted-foreground border-transparent hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className="flex-1 overflow-auto">
                {tab === "summary" && (
                  <table className="w-full text-sm">
                    <tbody>
                      {selected.factors.map((f, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-b border-border",
                            i === selected.factors.length - 1 && "border-b-0",
                          )}
                        >
                          <td className="px-5 py-3 text-foreground w-1/2">
                            <div className="flex items-center gap-2">
                              {f.flag && (
                                <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                              )}
                              {f.label}
                            </div>
                          </td>
                          <td className="px-5 py-3 font-mono text-[12px] text-foreground tabular-nums">
                            {f.value}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {tab === "evidence" && (
                  <table className="w-full text-sm">
                    <thead className="bg-secondary border-b border-border">
                      <tr>
                        <th className="text-left px-5 py-2 font-medium text-muted-foreground text-[10px] uppercase tracking-wider">
                          Type
                        </th>
                        <th className="text-left px-5 py-2 font-medium text-muted-foreground text-[10px] uppercase tracking-wider">
                          Reference
                        </th>
                        <th className="text-left px-5 py-2 font-medium text-muted-foreground text-[10px] uppercase tracking-wider">
                          Integrity Hash
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.evidence.length === 0 ? (
                        <tr>
                          <td
                            colSpan={3}
                            className="px-5 py-8 text-center text-xs text-muted-foreground"
                          >
                            No evidence attached.
                          </td>
                        </tr>
                      ) : (
                        selected.evidence.map((e, i) => (
                          <tr
                            key={i}
                            className="border-b border-border last:border-b-0"
                          >
                            <td className="px-5 py-3 text-foreground">
                              {e.type}
                            </td>
                            <td className="px-5 py-3 font-mono text-[12px] text-foreground">
                              {e.ref}
                            </td>
                            <td className="px-5 py-3 font-mono text-[12px] text-muted-foreground truncate">
                              {e.hash}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                )}

                {tab === "notes" && (
                  <div className="divide-y divide-border">
                    {selected.notes.length === 0 ? (
                      <div className="px-5 py-8 text-center text-xs text-muted-foreground">
                        No analyst notes recorded.
                      </div>
                    ) : (
                      selected.notes.map((n, i) => (
                        <div key={i} className="px-5 py-3.5">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                            <User className="h-3 w-3" />
                            <span className="text-foreground font-medium">
                              {n.actor}
                            </span>
                            <span>·</span>
                            <span className="font-mono">{n.role}</span>
                            <span className="ml-auto font-mono tabular-nums">
                              {n.at}
                            </span>
                          </div>
                          <p className="text-sm text-foreground leading-relaxed">
                            {n.text}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Action bar */}
              <div className="border-t border-border bg-secondary/50 px-5 py-3 flex items-center gap-2">
                <span className="text-[11px] font-mono text-muted-foreground mr-auto">
                  Decision logged to immutable audit ledger
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                >
                  <Flag className="h-3.5 w-3.5" />
                  Escalate
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs hover:text-destructive hover:border-destructive/40"
                >
                  <X className="h-3.5 w-3.5" />
                  Reject
                </Button>
                <Button
                  size="sm"
                  className="bg-foreground text-background hover:bg-foreground/90 gap-1.5 text-xs"
                >
                  <Check className="h-3.5 w-3.5" />
                  Approve
                </Button>
              </div>
            </div>
          </div>

          <p className="mt-4 text-xs text-muted-foreground font-mono">
            All adjudications recorded with SHA-256 attestation · Governor
            actions cannot be reversed without Director override.
          </p>
        </div>
      </main>
    </div>
  );
}
