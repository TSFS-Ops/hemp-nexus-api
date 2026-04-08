/**
 * Right-hand governance panel — immutable system log.
 * Staggered row entrance animation. Hover states on rows.
 */

const ACTIVITY_LOG = [
  { event_id: "evt_9f8a72bc", title: "POI Issued", detail: "Copper cathode — Zambia to China corridor", status: "verified" as const, hash: "0x4a2b...9f1e", time: "2m ago" },
  { event_id: "evt_3c1d4e5f", title: "Eligibility Check Initiated", detail: "Entity verification — West Africa mining consortium", status: "pending" as const, hash: "0x7c8d...2a4b", time: "8m ago" },
  { event_id: "evt_6b5a9c2d", title: "Counterparty Verification", detail: "KYC/AML documentation in progress", status: "pending" as const, hash: "0x1e3f...8c9a", time: "14m ago" },
  { event_id: "evt_8d2e1f4a", title: "Discovery Signal Recorded", detail: "Lithium buyer intent — DRC to Europe", status: "verified" as const, hash: "0x9a1b...4c2d", time: "22m ago" },
  { event_id: "evt_5f4e3d2c", title: "Compliance Workflow Triggered", detail: "Cross-border trade review (Sanctions screen pass)", status: "verified" as const, hash: "0x3d2c...1b0a", time: "31m ago" },
  { event_id: "evt_1a2b3c4d", title: "WaD Progression Confirmed", detail: "Settlement milestone reached — Escrow locked", status: "verified" as const, hash: "0x5e6f...7a8b", time: "45m ago" },
  { event_id: "evt_0f9e8d7c", title: "Jurisdiction Notice", detail: "Updated SADC trade requirements enforced", status: "system" as const, hash: "sys_update_v2.4", time: "1h ago" },
];

function StatusDot({ status }: { status: "verified" | "pending" | "system" | "scanning" }) {
  const base = "inline-block h-1.5 w-1.5 rounded-full flex-shrink-0 transition-colors";
  const color =
    status === "verified" ? "bg-signal-verified"
    : status === "pending" ? "bg-signal-pending"
    : status === "scanning" ? "bg-primary animate-pulse"
    : "bg-foreground/20";

  return <span className={`${base} ${color}`} />;
}

interface GovernancePanelProps {
  isScanning?: boolean;
}

export function GovernancePanel({ isScanning = false }: GovernancePanelProps) {
  return (
    <div className="border border-border lg:border-0 h-full flex flex-col bg-background">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
          <span className="text-[10px] font-mono font-medium uppercase tracking-widest text-muted-foreground">
            Platform Activity (Illustrative)
          </span>
        </div>
        <span className={`text-[9px] font-mono uppercase tracking-widest transition-colors ${
          isScanning ? "text-primary" : "text-muted-foreground/40"
        }`}>
          {isScanning ? "Scanning" : "Sample"}
        </span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-hidden">
        {/* Scanning entry */}
        {isScanning && (
          <div className="flex items-start gap-2.5 px-3 py-2.5 border-b border-primary/20 bg-primary/[0.03] animate-slide-down">
            <div className="mt-1.5 flex-shrink-0">
              <StatusDot status="scanning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono font-medium text-foreground/70 leading-tight">
                Scanning verified counterparties...
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">
                Querying registered data sources
              </p>
            </div>
            <span className="text-[9px] font-mono text-primary flex-shrink-0 mt-0.5 animate-pulse">
              now
            </span>
          </div>
        )}

        {ACTIVITY_LOG.map((item, i) => (
          <div
            key={item.event_id}
            className={`flex items-start gap-2.5 px-3 py-2.5 border-b border-border last:border-0
                       hover:bg-accent/20 transition-all duration-200 group cursor-default
                       animate-fade-in ${isScanning ? "opacity-30" : ""}`}
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="mt-1.5 flex-shrink-0">
              <StatusDot status={item.status} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-foreground leading-tight group-hover:text-foreground transition-colors">
                {item.title}
              </p>
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                {item.detail}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/30 mt-0.5 truncate group-hover:text-muted-foreground/50 transition-colors">
                {item.hash}
              </p>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/40 flex-shrink-0 mt-0.5 whitespace-nowrap">
              {item.time}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-border">
        <p className="text-[8px] font-mono text-muted-foreground/25 uppercase tracking-widest">
          Illustrative only · Not live platform data
        </p>
      </div>
    </div>
  );
}
