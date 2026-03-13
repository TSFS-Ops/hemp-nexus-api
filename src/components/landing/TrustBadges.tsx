/**
 * Trust badges row — 4 key platform attributes.
 * Mobile: 1-column stack with 16px spacing.
 * Desktop: 4-column grid, centered within each cell.
 */

import { ShieldCheck, Brain, FileCheck, ScrollText } from "lucide-react";

const BADGES = [
  { icon: ShieldCheck, title: "Secure & Governed", desc: "End-to-end encryption" },
  { icon: Brain, title: "AI Matching", desc: "Real-time counterparty" },
  { icon: FileCheck, title: "Structured POI", desc: "Legally binding" },
  { icon: ScrollText, title: "Audit Trail", desc: "Immutable records" },
];

export function TrustBadges() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 border border-border bg-background">
      {BADGES.map((badge, i) => (
        <div
          key={badge.title}
          className={`flex items-center justify-center gap-3 px-4 py-4
                     ${i > 0 ? "sm:border-l border-border" : ""}
                     ${i > 0 ? "border-t sm:border-t-0 border-border" : ""}`}
        >
          <badge.icon className="h-5 w-5 text-primary/60 flex-shrink-0" />
          <div>
            <span className="text-[12px] font-semibold text-foreground block leading-tight">{badge.title}</span>
            <span className="text-[11px] text-muted-foreground font-medium">{badge.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
