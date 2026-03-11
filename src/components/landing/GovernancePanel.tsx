/**
 * Right-hand governance / institutional activity panel.
 * Designed as system-log entries with timestamps — not consumer cards.
 */

import { Shield, CheckCircle, Search, FileText, Scale, Bell, GitCommit } from "lucide-react";

const GOVERNANCE_ITEMS = [
  { icon: FileText, label: "POI issued", detail: "Copper cathode — Zambia corridor", time: "2m ago" },
  { icon: CheckCircle, label: "Eligibility check initiated", detail: "Entity verification — West Africa", time: "8m ago" },
  { icon: Shield, label: "Counterparty verification", detail: "KYC documentation in progress", time: "14m ago" },
  { icon: Search, label: "Discovery signal recorded", detail: "Lithium buyer intent — DRC", time: "22m ago" },
  { icon: Scale, label: "Compliance workflow triggered", detail: "Cross-border trade review", time: "31m ago" },
  { icon: GitCommit, label: "WaD progression confirmed", detail: "Settlement milestone reached", time: "45m ago" },
  { icon: Bell, label: "Jurisdiction notice", detail: "Updated SADC trade requirements", time: "1h ago" },
];

export function GovernancePanel() {
  return (
    <div className="border border-border rounded-sm bg-card h-full">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-primary" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          Platform Activity
        </span>
      </div>
      <div className="p-3 space-y-0">
        {GOVERNANCE_ITEMS.map((item, i) => (
          <div
            key={i}
            className="flex items-start gap-2.5 py-2.5 border-b border-border/50 last:border-0"
          >
            <div className="mt-0.5 flex-shrink-0">
              <item.icon className="h-3 w-3 text-muted-foreground/70" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-foreground leading-tight">{item.label}</p>
              <p className="text-[11px] text-muted-foreground/70 truncate mt-0.5">{item.detail}</p>
            </div>
            <span className="text-[10px] text-muted-foreground/50 flex-shrink-0 mt-0.5 font-mono">
              {item.time}
            </span>
          </div>
        ))}
      </div>
      <div className="px-4 py-2 border-t border-border">
        <p className="text-[9px] text-muted-foreground/40 leading-relaxed">
          Indicative governance signals. Representative of platform activity patterns.
        </p>
      </div>
    </div>
  );
}
