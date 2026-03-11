/**
 * Right-hand governance panel — immutable system log aesthetic.
 * Supports temporary "scanning" overlay entry during search.
 */

import { useState, useEffect } from "react";

const ACTIVITY_LOG = [
  {
    event_id: "evt_9f8a72bc",
    title: "POI Issued",
    detail: "Copper cathode — Zambia to China corridor",
    status: "verified" as const,
    hash: "0x4a2b...9f1e",
    time: "2m ago",
  },
  {
    event_id: "evt_3c1d4e5f",
    title: "Eligibility Check Initiated",
    detail: "Entity verification — West Africa mining consortium",
    status: "pending" as const,
    hash: "0x7c8d...2a4b",
    time: "8m ago",
  },
  {
    event_id: "evt_6b5a9c2d",
    title: "Counterparty Verification",
    detail: "KYC/AML documentation in progress",
    status: "pending" as const,
    hash: "0x1e3f...8c9a",
    time: "14m ago",
  },
  {
    event_id: "evt_8d2e1f4a",
    title: "Discovery Signal Recorded",
    detail: "Lithium buyer intent — DRC to Europe",
    status: "verified" as const,
    hash: "0x9a1b...4c2d",
    time: "22m ago",
  },
  {
    event_id: "evt_5f4e3d2c",
    title: "Compliance Workflow Triggered",
    detail: "Cross-border trade review (Sanctions screen pass)",
    status: "verified" as const,
    hash: "0x3d2c...1b0a",
    time: "31m ago",
  },
  {
    event_id: "evt_1a2b3c4d",
    title: "WaD Progression Confirmed",
    detail: "Settlement milestone reached — Escrow locked",
    status: "verified" as const,
    hash: "0x5e6f...7a8b",
    time: "45m ago",
  },
  {
    event_id: "evt_0f9e8d7c",
    title: "Jurisdiction Notice",
    detail: "Updated SADC trade requirements enforced",
    status: "system" as const,
    hash: "sys_update_v2.4",
    time: "1h ago",
  },
];

function StatusDot({ status }: { status: "verified" | "pending" | "system" | "scanning" }) {
  const colorClass =
    status === "verified"
      ? "bg-signal-verified"
      : status === "pending"
      ? "bg-signal-pending"
      : status === "scanning"
      ? "bg-primary animate-pulse"
      : "bg-foreground/30";

  return (
    <span className={`inline-block h-1.5 w-1.5 rounded-full ${colorClass} flex-shrink-0`} />
  );
}

interface GovernancePanelProps {
  isScanning?: boolean;
}

export function GovernancePanel({ isScanning = false }: GovernancePanelProps) {
  return (
    <div className="border border-border h-full flex flex-col lg:border-0">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <span className="text-[10px] font-mono font-medium uppercase tracking-widest text-muted-foreground">
          Platform Activity
        </span>
        <span className={`text-[9px] font-mono uppercase tracking-widest ${
          isScanning ? "text-primary animate-pulse" : "text-muted-foreground/50"
        }`}>
          {isScanning ? "Scanning" : "Live"}
        </span>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-hidden">
        {/* Scanning entry — injected at top when active */}
        {isScanning && (
          <div className="flex items-start gap-2 px-3 py-2 border-b border-border bg-primary/5">
            <div className="mt-1.5 flex-shrink-0">
              <StatusDot status="scanning" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-mono font-medium text-muted-foreground leading-tight">
                Scanning verified counterparties...
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">
                Querying registered data sources
              </p>
            </div>
            <span className="text-[9px] font-mono text-primary flex-shrink-0 mt-0.5 whitespace-nowrap animate-pulse">
              now
            </span>
          </div>
        )}

        {ACTIVITY_LOG.map((item) => (
          <div
            key={item.event_id}
            className={`flex items-start gap-2 px-3 py-2 border-b border-border last:border-0 transition-opacity duration-300 ${
              isScanning ? "opacity-40" : "opacity-100"
            }`}
          >
            <div className="mt-1.5 flex-shrink-0">
              <StatusDot status={item.status} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-foreground leading-tight">
                {item.title}
              </p>
              <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                {item.detail}
              </p>
              <p className="text-[9px] font-mono text-muted-foreground/40 mt-0.5 truncate">
                {item.hash}
              </p>
            </div>
            <span className="text-[9px] font-mono text-muted-foreground/50 flex-shrink-0 mt-0.5 whitespace-nowrap">
              {item.time}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border">
        <p className="text-[8px] font-mono text-muted-foreground/30 uppercase tracking-widest">
          Indicative governance signals · Production environment
        </p>
      </div>
    </div>
  );
}
