/**
 * Trust badges row — 4 key platform attributes.
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
    <div className="grid grid-cols-2 sm:grid-cols-4 border border-border bg-background">
      {BADGES.map((badge, i) => (
        <div
          key={badge.title}
          className={`flex items-center gap-3 px-4 py-3
                     ${i > 0 ? "sm:border-l border-border" : ""}
                     ${i >= 2 ? "border-t sm:border-t-0 border-border" : ""}`}
        >
          <badge.icon className="h-5 w-5 text-primary/60 flex-shrink-0" />
          <div>
            <span className="text-[11px] font-semibold text-foreground block leading-tight">{badge.title}</span>
            <span className="text-[9px] text-muted-foreground/60">{badge.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
