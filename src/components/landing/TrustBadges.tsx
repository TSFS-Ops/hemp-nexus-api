/**
 * Trust badges — dark terminal cards with emerald icons.
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
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-0 rounded-md overflow-hidden"
         style={{ border: '1px solid var(--lt-border)' }}>
      {BADGES.map((badge, i) => (
        <div
          key={badge.title}
          className="flex items-center justify-center gap-3 px-4 py-3.5 transition-colors duration-200 hover:bg-white/[0.02]"
          style={{
            backgroundColor: 'var(--lt-surface)',
            ...(i > 0 ? { borderLeft: '1px solid var(--lt-border)' } : {}),
          }}
        >
          <badge.icon className="h-5 w-5 flex-shrink-0" style={{ color: 'var(--lt-emerald)', opacity: 0.7 }} />
          <div>
            <span className="text-[12px] font-semibold block leading-tight" style={{ color: 'var(--lt-text)' }}>{badge.title}</span>
            <span className="text-[11px] font-medium" style={{ color: 'var(--lt-text-dim)' }}>{badge.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
