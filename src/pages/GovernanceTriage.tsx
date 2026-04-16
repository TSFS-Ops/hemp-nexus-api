import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Inbox,
  AlertTriangle,
  FileText,
  Download,
  Shield,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Mock data
// ─────────────────────────────────────────────────────────────
type RiskLevel = "low" | "med" | "high";

interface PendingTrade {
  id: string;
  uuid: string;
  buyer: string;
  seller: string;
  commodity: string;
  volume: string;
  risk: RiskLevel;
  riskScore: number;
  submittedAt: string;
}

const PENDING_TRADES: PendingTrade[] = [
  {
    id: "1",
    uuid: "a4f2e8c1-9b3d-4e7a-8c6f-2d1e9b5a4c8f",
    buyer: "Kruger Trading",
    seller: "Aurubis",
    commodity: "Copper Cathode",
    volume: "500 MT",
    risk: "med",
    riskScore: 65,
    submittedAt: "14:02:45",
  },
  {
    id: "2",
    uuid: "b8e3d2a5-1c4f-4a9b-9e8d-7f3c2b1a5d6e",
    buyer: "Glencore SA",
    seller: "Anglo Platinum",
    commodity: "Platinum Sponge",
    volume: "120 KG",
    risk: "low",
    riskScore: 22,
    submittedAt: "13:48:11",
  },
  {
    id: "3",
    uuid: "c1d4f6b2-7e8a-4c3d-9f1b-5a2e8d4c7b9f",
    buyer: "Trafigura BV",
    seller: "Sibanye-Stillwater",
    commodity: "Gold Doré",
    volume: "85 KG",
    risk: "high",
    riskScore: 87,
    submittedAt: "13:31:02",
  },
  {
    id: "4",
    uuid: "d2e5a7b3-8f9c-4d1e-a2c4-6b3f9e5d8c1a",
    buyer: "Mercuria Energy",
    seller: "Exxaro Resources",
    commodity: "Thermal Coal",
    volume: "25,000 MT",
    risk: "low",
    riskScore: 18,
    submittedAt: "12:55:38",
  },
  {
    id: "5",
    uuid: "e3f6b8c4-9a1d-4e2f-b3d5-7c4a1f6e9d2b",
    buyer: "Vitol Group",
    seller: "Sasol Limited",
    commodity: "Crude Oil",
    volume: "1M Barrels",
    risk: "med",
    riskScore: 54,
    submittedAt: "12:14:22",
  },
  {
    id: "6",
    uuid: "f4a7c9d5-b2e3-4f1a-c4e6-8d5b2a7f1e3c",
    buyer: "Cargill Africa",
    seller: "Tongaat Hulett",
    commodity: "Raw Sugar",
    volume: "10,000 MT",
    risk: "low",
    riskScore: 12,
    submittedAt: "11:47:09",
  },
];

interface Gate {
  id: string;
  label: string;
  status: "passed" | "pending" | "failed";
}

const GATES: Gate[] = [
  { id: "1", label: "Gate 1: Counterparty identity verified", status: "passed" },
  { id: "2", label: "Gate 2: Sanctions & PEP screening clear", status: "passed" },
  { id: "3", label: "Gate 3: UBO disclosure ≥ 75%", status: "passed" },
  { id: "4a", label: "Gate 4a: Commercial terms agreed", status: "passed" },
  { id: "4b", label: "Gate 4b: Explicit jurisdiction selection", status: "pending" },
  { id: "5", label: "Gate 5: Authority to bind verified", status: "passed" },
  { id: "6", label: "Gate 6: Governance documents uploaded", status: "passed" },
  { id: "7", label: "Gate 7: Token burn pre-authorised", status: "passed" },
  { id: "8", label: "Gate 8: Cryptographic attestation signed", status: "passed" },
  { id: "9", label: "Gate 9: WaD issuance approval", status: "pending" },
];

// ─────────────────────────────────────────────────────────────
// Sidebar
// ─────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  { to: "/governance/triage", label: "Triage Queue", icon: Inbox },
  { to: "/governance/disputes", label: "Active Disputes", icon: AlertTriangle },
  { to: "/governance/audit", label: "Audit Logs", icon: FileText },
  { to: "/governance/export", label: "Evidence Export", icon: Download },
];

function GovernorSidebar() {
  return (
    <aside className="w-60 shrink-0 border-r border-border bg-background">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <Shield className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold tracking-tight">Governance Console</span>
      </div>
      <nav className="p-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────
// Risk Badge
// ─────────────────────────────────────────────────────────────
function RiskBadge({ risk }: { risk: RiskLevel }) {
  const styles: Record<RiskLevel, string> = {
    low: "bg-emerald-50 text-emerald-700 border-emerald-200",
    med: "bg-amber-50 text-amber-700 border-amber-200",
    high: "bg-red-50 text-red-700 border-red-200",
  };
  const labels: Record<RiskLevel, string> = {
    low: "Low Risk",
    med: "Med Risk",
    high: "High Risk",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
        styles[risk],
      )}
    >
      {labels[risk]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Gate Item
// ─────────────────────────────────────────────────────────────
function GateItem({ gate }: { gate: Gate }) {
  const icon =
    gate.status === "passed" ? (
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
    ) : gate.status === "pending" ? (
      <Clock className="h-4 w-4 text-amber-600" />
    ) : (
      <XCircle className="h-4 w-4 text-red-600" />
    );

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5">{icon}</div>
      <span
        className={cn(
          "text-sm",
          gate.status === "pending" ? "text-foreground font-medium" : "text-muted-foreground",
        )}
      >
        {gate.label}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function GovernanceTriage() {
  const [selectedId, setSelectedId] = useState(PENDING_TRADES[0].id);
  const selected = PENDING_TRADES.find((t) => t.id === selectedId)!;
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen bg-background">
      <GovernorSidebar />

      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="border-b border-border bg-background px-8 py-5">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Pending Approvals</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Review and clear trades for WaD Issuance
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
              Exit Console
            </Button>
          </div>
        </header>

        {/* Split-pane container */}
        <div className="flex-1 p-6">
          <div className="flex h-[calc(100vh-7.5rem)] rounded-md border border-border bg-background overflow-hidden">
            {/* LEFT PANE — Triage Queue (35%) */}
            <div className="w-[35%] border-r border-border flex flex-col">
              <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-4 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Triage Queue
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {PENDING_TRADES.length} pending
                </span>
              </div>
              <ScrollArea className="flex-1">
                <ul>
                  {PENDING_TRADES.map((trade) => {
                    const isSelected = trade.id === selectedId;
                    return (
                      <li key={trade.id}>
                        <button
                          onClick={() => setSelectedId(trade.id)}
                          className={cn(
                            "w-full text-left border-b border-border px-4 py-3 transition-colors",
                            isSelected
                              ? "bg-secondary/60 border-l-2 border-l-primary"
                              : "border-l-2 border-l-transparent hover:bg-secondary/30",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1.5">
                            <span className="text-sm font-medium text-foreground">
                              {trade.buyer} ↔ {trade.seller}
                            </span>
                            <RiskBadge risk={trade.risk} />
                          </div>
                          <div className="text-xs text-muted-foreground mb-1">
                            {trade.volume} {trade.commodity}
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground/70">
                            {trade.submittedAt}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </div>

            {/* RIGHT PANE — 9-Gate Review (65%) */}
            <div className="flex-1 flex flex-col">
              {/* Top: UUID + risk indicator */}
              <div className="border-b border-border px-6 py-4 flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                    Match UUID
                  </span>
                  <span className="font-mono text-sm text-foreground">{selected.uuid}</span>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                    Risk Score
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        selected.risk === "low" && "bg-emerald-500",
                        selected.risk === "med" && "bg-amber-500",
                        selected.risk === "high" && "bg-red-500",
                      )}
                    />
                    <span className="text-base font-semibold">
                      {selected.risk === "low"
                        ? "Low Risk"
                        : selected.risk === "med"
                          ? "Medium Risk"
                          : "High Risk"}{" "}
                      <span className="font-mono text-muted-foreground">
                        ({selected.riskScore}%)
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {/* Two-column grid */}
              <ScrollArea className="flex-1">
                <div className="grid grid-cols-2 gap-6 p-6">
                  {/* Column 1: Entity Context */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-3">
                      Entity Context
                    </h3>
                    <div className="border border-border rounded-md divide-y divide-border">
                      <div className="flex items-start justify-between px-3 py-2.5">
                        <div>
                          <div className="text-sm font-medium">Dilisense Screening</div>
                          <div className="text-xs text-muted-foreground">
                            Sanctions / PEP / Adverse Media
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Clear
                        </span>
                      </div>
                      <div className="flex items-start justify-between px-3 py-2.5">
                        <div>
                          <div className="text-sm font-medium">SAHPRA Licence</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            LIC-2024-0847
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Active
                        </span>
                      </div>
                      <div className="flex items-start justify-between px-3 py-2.5">
                        <div>
                          <div className="text-sm font-medium">UBO Verification</div>
                          <div className="text-xs text-muted-foreground">
                            Beneficial ownership disclosed
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          <span className="font-mono">{">"} 75% Verified</span>
                        </span>
                      </div>
                      <div className="flex items-start justify-between px-3 py-2.5">
                        <div>
                          <div className="text-sm font-medium">Jurisdiction</div>
                          <div className="text-xs text-muted-foreground">
                            Awaiting explicit selection
                          </div>
                        </div>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          <Clock className="h-3.5 w-3.5" />
                          Pending
                        </span>
                      </div>
                    </div>
                  </section>

                  {/* Column 2: 9-Gate Checklist */}
                  <section>
                    <h3 className="text-xs uppercase tracking-wide text-muted-foreground font-semibold mb-3">
                      9-Gate WaD Checklist
                    </h3>
                    <div className="border border-border rounded-md p-3">
                      {GATES.map((gate) => (
                        <GateItem key={gate.id} gate={gate} />
                      ))}
                    </div>
                  </section>
                </div>
              </ScrollArea>

              {/* Sticky action bar */}
              <div className="border-t border-border bg-background px-6 py-3 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  Reject Trade
                </Button>
                <Button variant="outline" size="sm">
                  Request Info
                </Button>
                <Button size="sm" className="bg-emerald-700 hover:bg-emerald-800 text-white">
                  Approve &amp; Seal
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
