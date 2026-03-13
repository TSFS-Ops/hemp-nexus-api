/**
 * Bottom status bar — replaces the misleading commodity ticker
 * with platform identity and compliance status indicators.
 */

import { ShieldCheck, Lock, FileCheck } from "lucide-react";

const STATUS_ITEMS = [
  { icon: ShieldCheck, label: "KYC Verified", status: "Enforced" },
  { icon: Lock, label: "Cryptographic Seals", status: "Active" },
  { icon: FileCheck, label: "Audit Trail", status: "Append-Only" },
];

export function CommodityTicker() {
  return (
    <div className="border-t border-border bg-background select-none overflow-hidden">
      <div className="flex items-center h-8">
        {/* Platform label */}
        <div className="flex-shrink-0 px-3 border-r border-border h-full flex items-center">
          <span className="text-[10px] font-mono font-medium text-primary uppercase tracking-widest">
            Compliance Status
          </span>
        </div>
        {/* Status indicators */}
        <div className="flex-1 flex items-center">
          {STATUS_ITEMS.map((item) => (
            <div
              key={item.label}
              className="flex-shrink-0 flex items-center gap-2 px-4 border-r border-border h-8"
            >
              <item.icon className="h-3 w-3 text-signal-verified" />
              <span className="text-[10px] font-semibold text-foreground">{item.label}</span>
              <span className="text-[10px] font-mono text-signal-verified">{item.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}