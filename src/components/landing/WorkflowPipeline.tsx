/**
 * 6-step KYC-to-WaD workflow pipeline — Bloomberg terminal style.
 * Custom SVG icons, emerald-highlighted final step, dark aesthetic.
 */

import { useState } from "react";
import { Search, Users, ArrowRight, ShieldCheck, Brain, Handshake, FileText, CheckCircle2, Lock } from "lucide-react";

const PIPELINE_STEPS = [
  { label: "KYC + AI", subtitle: "Verify identity", Icon: ShieldCheck },
  { label: "AI+ Analysis", subtitle: "Match & Score", Icon: Brain },
  { label: "Counterparty Found", subtitle: "Review Options", Icon: Handshake },
  { label: "Create POI", subtitle: "Structuring", Icon: FileText },
  { label: "Commit", subtitle: "to POI", Icon: CheckCircle2 },
  { label: "WaD", subtitle: "Without-a-Doubt", Icon: Lock },
];

export function WorkflowPipeline() {
  const [activeTab, setActiveTab] = useState<"bid" | "buyer">("bid");

  return (
    <div className="rounded-md" style={{ backgroundColor: 'var(--lt-surface)', border: '1px solid var(--lt-border)' }}>
      {/* Toggle: Find a Bid/Offer OR Find a Buyer/Seller */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center sm:justify-center gap-0 sm:gap-3 px-4 py-3 sm:py-4"
           style={{ borderBottom: '1px solid var(--lt-border)' }}>
        <button
          onClick={() => setActiveTab("bid")}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-mono uppercase tracking-wider font-semibold
                     transition-all duration-200 justify-center w-full sm:w-auto sm:flex-1 sm:max-w-[240px] rounded-md"
          style={{
            backgroundColor: activeTab === "bid" ? 'var(--lt-emerald-dark)' : 'transparent',
            color: activeTab === "bid" ? 'white' : 'var(--lt-text-muted)',
            border: activeTab === "bid" ? 'none' : '1px solid var(--lt-border)',
          }}
        >
          <Search className="h-3.5 w-3.5" />
          Find a Bid / Offer
        </button>

        <div className="flex items-center justify-center gap-3 py-2 sm:py-0 sm:gap-0">
          <div className="flex-1 h-px sm:hidden" style={{ backgroundColor: 'var(--lt-border)' }} />
          <span className="text-[11px] font-mono uppercase tracking-wider px-3" style={{ color: 'var(--lt-text-dim)' }}>—&nbsp;&nbsp;or&nbsp;&nbsp;—</span>
          <div className="flex-1 h-px sm:hidden" style={{ backgroundColor: 'var(--lt-border)' }} />
        </div>

        <button
          onClick={() => setActiveTab("buyer")}
          className="inline-flex items-center gap-2 px-5 py-2.5 text-[11px] font-mono uppercase tracking-wider font-semibold
                     transition-all duration-200 justify-center w-full sm:w-auto sm:flex-1 sm:max-w-[240px] rounded-md"
          style={{
            backgroundColor: activeTab === "buyer" ? 'var(--lt-emerald-dark)' : 'transparent',
            color: activeTab === "buyer" ? 'white' : 'var(--lt-text-muted)',
            border: activeTab === "buyer" ? 'none' : '1px solid var(--lt-border)',
          }}
        >
          <Users className="h-3.5 w-3.5" />
          Find a Buyer / Seller
        </button>
      </div>

      {/* 6-step pipeline */}
      <div className="px-4 py-5 overflow-x-auto scrollbar-hide">
        <div className="flex items-center sm:justify-between gap-1" style={{ minWidth: '650px' }}>
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1 flex-shrink-0">
              <div className="flex flex-col items-center text-center min-w-[90px]">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-all duration-200"
                  style={{
                    border: i === PIPELINE_STEPS.length - 1
                      ? '1.5px solid var(--lt-emerald)'
                      : '1px solid var(--lt-border)',
                    backgroundColor: i === PIPELINE_STEPS.length - 1
                      ? 'rgba(16, 185, 129, 0.1)'
                      : 'var(--lt-panel)',
                  }}
                >
                  <step.Icon
                    className="h-4.5 w-4.5"
                    style={{
                      color: i === PIPELINE_STEPS.length - 1
                        ? 'var(--lt-emerald)'
                        : 'var(--lt-text-muted)',
                      width: '18px',
                      height: '18px',
                    }}
                  />
                </div>
                <span className="text-[11px] font-semibold leading-tight" style={{ color: 'var(--lt-text)' }}>{step.label}</span>
                <span className="text-[10px] font-medium leading-tight mt-0.5" style={{ color: 'var(--lt-text-dim)' }}>{step.subtitle}</span>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <ArrowRight className="h-3 w-3 flex-shrink-0 mx-1" style={{ color: 'var(--lt-border-hover)' }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
