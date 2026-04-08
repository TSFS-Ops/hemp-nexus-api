/**
 * Trust signal strip: institutional certification badges and compliance marks.
 */

import iso27001Badge from "@/assets/iso-27001-badge.png";
import popiaBadge from "@/assets/popia-badge.png";
import { ShieldCheck, FileCheck } from "lucide-react";

export function TrustBadges() {
  return (
    <div className="flex flex-col gap-4">
      {/* Certification badges */}
      <div className="flex items-center justify-center gap-6 sm:gap-10">
        <img
          src={iso27001Badge}
          alt="ISO 27001 Certified"
          loading="lazy"
          width={512}
          height={512}
          className="h-14 sm:h-16 w-auto opacity-70 hover:opacity-100 transition-opacity duration-200"
        />
        <img
          src={popiaBadge}
          alt="POPIA Compliant"
          loading="lazy"
          width={512}
          height={512}
          className="h-14 sm:h-16 w-auto opacity-70 hover:opacity-100 transition-opacity duration-200"
        />
      </div>

      {/* Compact trust descriptors */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#131823', border: '1px solid var(--lt-border)' }}>
          <ShieldCheck className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--lt-emerald-bright)', opacity: 0.85 }} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--lt-text-dim)' }}>
            Signed deals cryptographically sealed on the Izenzo Ledger
          </span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: '#131823', border: '1px solid var(--lt-border)' }}>
          <FileCheck className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--lt-emerald-bright)', opacity: 0.85 }} />
          <span className="text-[11px] font-medium" style={{ color: 'var(--lt-text-dim)' }}>
            Audit-ready evidence packs for insurers and financiers
          </span>
        </div>
      </div>
    </div>
  );
}
