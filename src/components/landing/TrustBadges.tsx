/**
 * Trust badges - premium dark glass cards with emerald icons.
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
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
      {BADGES.map((badge) => (
        <div
          key={badge.title}
          className="flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 hover:border-emerald-500/30"
          style={{
            backgroundColor: '#131823',
            border: '1px solid var(--lt-border)',
          }}
        >
          <badge.icon className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--lt-emerald-bright)', opacity: 0.85 }} />
          <div>
            <span className="text-[12px] font-semibold block leading-tight" style={{ color: 'var(--lt-text)' }}>{badge.title}</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--lt-text-dim)' }}>{badge.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
