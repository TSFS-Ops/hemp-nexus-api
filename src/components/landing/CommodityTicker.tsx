/**
 * Bottom status bar — compliance status indicators.
 * Mobile: horizontally scrollable with hidden scrollbar.
 * Desktop: static flex row.
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
      <div className="flex items-center h-8 overflow-x-auto scrollbar-hide">
        {/* Platform label */}
        <div className="flex-shrink-0 px-3 border-r border-border h-full flex items-center">
          <span className="text-[11px] font-mono font-medium text-primary uppercase tracking-widest whitespace-nowrap">
            Compliance Status
          </span>
        </div>
        {/* Status indicators */}
        <div className="flex items-center flex-shrink-0">
          {STATUS_ITEMS.map((item) => (
            <div
              key={item.label}
              className="flex-shrink-0 flex items-center gap-2 px-4 border-r border-border h-8 whitespace-nowrap"
            >
              <item.icon className="h-3 w-3 text-signal-verified flex-shrink-0" />
              <span className="text-[11px] font-semibold text-foreground">{item.label}</span>
              <span className="text-[11px] font-mono font-medium text-signal-verified">{item.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
