/**
 * Right-hand sidebar — platform capabilities + compliance status.
 * Uses --surface-sidebar (#F9FAFB) background to visually separate from main workspace.
 */

import { ArrowRight, ShieldCheck, Search, FileCheck, Lock, Scale } from "lucide-react";

const PLATFORM_CAPABILITIES = [
  { label: "KYC & Identity Verification", icon: ShieldCheck, status: "Active" },
  { label: "Sanctions Screening", icon: Search, status: "Active" },
  { label: "Cryptographic Evidence", icon: Lock, status: "Active" },
  { label: "Compliance Matching", icon: Scale, status: "Active" },
  { label: "Document Vault", icon: FileCheck, status: "Active" },
];

const RECENT_UPDATES = [
  { headline: "WaD seal verification now enforced", time: "System" },
  { headline: "Multi-party attestation live", time: "System" },
  { headline: "Tiered approval workflow active", time: "System" },
  { headline: "Append-only audit ledger enabled", time: "System" },
];

export function MarketWatchSidebar() {
  return (
    <div className="border-l border-border flex flex-col h-full" style={{ backgroundColor: 'hsl(var(--surface-sidebar))' }}>
      {/* Platform Status */}
      <div className="flex-shrink-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal-verified" />
            <span className="text-[12px] font-semibold text-foreground tracking-tight">Platform Status</span>
          </div>
        </div>
        <div>
          {PLATFORM_CAPABILITIES.map((item) => (
            <div
              key={item.label}
              className="flex items-center justify-between px-4 py-2.5 border-b border-border"
            >
              <div className="flex items-center gap-2">
                <item.icon className="h-3 w-3 text-muted-foreground" />
                <span className="text-[12px] text-foreground font-medium">{item.label}</span>
              </div>
              <span className="text-[11px] font-mono font-medium text-signal-verified">
                {item.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* System Updates */}
      <div className="flex-1 min-h-0">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="text-[12px] font-semibold text-foreground tracking-tight">System</span>
        </div>
        <div>
          {RECENT_UPDATES.map((item, i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-border"
            >
              <p className="text-[12px] text-foreground font-medium leading-snug mb-1">{item.headline}</p>
              <span className="text-[11px] font-mono text-muted-foreground">{item.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Need help */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border">
        <p className="text-[12px] font-medium text-foreground mb-0.5">Need help?</p>
        <a
          href="/docs"
          className="text-[12px] text-primary font-medium inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
        >
          Read the docs
          <ArrowRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
