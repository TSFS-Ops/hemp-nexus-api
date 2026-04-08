/**
 * Trust signal grid: institutional language for DFIs, insurers, and financiers.
 */

import { ShieldCheck, Brain, FileCheck, ScrollText } from "lucide-react";

const BADGES = [
  {
    icon: ShieldCheck,
    title: "Sovereign Infrastructure",
    desc: "Governed by immutable audit trails and POPIA-compliant data residency.",
  },
  {
    icon: Brain,
    title: "Identity Assurance",
    desc: "Automated KYB and sanctions screening for every partner.",
  },
  {
    icon: FileCheck,
    title: "Signed Deals",
    desc: "Legally binding commitments cryptographically sealed on the Izenzo Ledger.",
  },
  {
    icon: ScrollText,
    title: "Evidence Packs",
    desc: "Audit-ready documentation bundles for insurers and financiers.",
  },
];

export function TrustBadges() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {BADGES.map((badge) => (
        <div
          key={badge.title}
          className="flex items-start gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 hover:border-emerald-500/30"
          style={{
            backgroundColor: '#131823',
            border: '1px solid var(--lt-border)',
          }}
        >
          <badge.icon className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--lt-emerald-bright)', opacity: 0.85 }} />
          <div>
            <span className="text-[12px] font-semibold block leading-tight" style={{ color: 'var(--lt-text)' }}>{badge.title}</span>
            <span className="text-[11px] font-medium leading-snug mt-0.5 block" style={{ color: 'var(--lt-text-dim)' }}>{badge.desc}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
