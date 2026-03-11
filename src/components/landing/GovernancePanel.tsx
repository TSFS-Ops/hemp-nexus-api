/**
 * Right-hand governance/institutional activity panel.
 * Phase 1: illustrative/representative labels, not live data.
 */

import { Shield, CheckCircle, Search, FileText, Scale, Bell } from "lucide-react";

const GOVERNANCE_ITEMS = [
  { icon: FileText, label: "POI issued", detail: "Copper cathode — Zambia corridor", time: "2m ago", category: "poi" },
  { icon: CheckCircle, label: "Eligibility check initiated", detail: "Entity verification — West Africa", time: "8m ago", category: "eligibility" },
  { icon: Shield, label: "Counterparty verification", detail: "KYC documentation in progress", time: "14m ago", category: "verification" },
  { icon: Search, label: "Discovery signal recorded", detail: "Lithium buyer intent — DRC", time: "22m ago", category: "discovery" },
  { icon: Scale, label: "Compliance workflow triggered", detail: "Cross-border trade review", time: "31m ago", category: "compliance" },
  { icon: FileText, label: "WaD progression confirmed", detail: "Settlement milestone reached", time: "45m ago", category: "wad" },
  { icon: Bell, label: "Jurisdiction notice", detail: "Updated SADC trade requirements", time: "1h ago", category: "system" },
];

export function GovernancePanel() {
  return (
    <div className="border border-border rounded-lg bg-card p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Platform Activity
        </h3>
      </div>
      <p className="text-[10px] text-muted-foreground/70 mb-3 leading-relaxed">
        Indicative governance signals. Representative of platform activity patterns.
      </p>
      <div className="space-y-3">
        {GOVERNANCE_ITEMS.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5 group">
            <div className="mt-0.5 flex-shrink-0">
              <item.icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground leading-tight">{item.label}</p>
              <p className="text-[11px] text-muted-foreground truncate">{item.detail}</p>
            </div>
            <span className="text-[10px] text-muted-foreground/60 flex-shrink-0 mt-0.5">{item.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
