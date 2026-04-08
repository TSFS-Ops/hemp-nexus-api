/**
 * 6-step KYC-to-WaD workflow pipeline - ultra-premium Bloomberg terminal style.
 * Clean header, no toggle. Emerald-highlighted WaD step.
 */

import { ArrowRight, ShieldCheck, Brain, Handshake, FileText, CheckCircle2, Lock } from "lucide-react";

const PIPELINE_STEPS = [
  { label: "KYC + AI", subtitle: "Verify identity", Icon: ShieldCheck },
  { label: "AI+ Analysis", subtitle: "Match & Score", Icon: Brain },
  { label: "Partner Found", subtitle: "Review Options", Icon: Handshake },
  { label: "Draft Intent", subtitle: "Structuring", Icon: FileText },
  { label: "Commit", subtitle: "to POI", Icon: CheckCircle2 },
  { label: "Finalised Commitment", subtitle: "Finalised Commitment", Icon: Lock },
];

export function WorkflowPipeline() {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        backgroundColor: 'rgba(15, 20, 32, 0.5)',
        border: '1px solid var(--lt-border)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Section label */}
      <div className="flex items-center gap-2 mb-5">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--lt-emerald)' }} />
        <span className="text-[11px] font-mono uppercase tracking-wider font-semibold" style={{ color: 'var(--lt-text-muted)' }}>
          How it works - From Discovery to Execution
        </span>
      </div>

      {/* 6-step pipeline */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex items-center sm:justify-between gap-1" style={{ minWidth: '650px' }}>
          {PIPELINE_STEPS.map((step, i) => {
            const isWad = i === PIPELINE_STEPS.length - 1;
            return (
              <div key={step.label} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className="flex flex-col items-center text-center min-w-[90px] px-2 py-3 rounded-xl transition-all duration-200"
                  style={isWad ? {
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid var(--lt-emerald-dark)',
                  } : {}}
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                    style={{
                      border: isWad
                        ? '1.5px solid var(--lt-emerald)'
                        : '1px solid var(--lt-border-hover)',
                      backgroundColor: isWad
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'var(--lt-panel)',
                    }}
                  >
                    <step.Icon
                      style={{
                        color: isWad ? 'var(--lt-emerald)' : 'var(--lt-text)',
                        width: '18px',
                        height: '18px',
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold leading-tight" style={{ color: isWad ? 'var(--lt-emerald)' : 'var(--lt-text)' }}>{step.label}</span>
                  <span className="text-[10px] font-medium leading-tight mt-0.5" style={{ color: 'var(--lt-text-dim)' }}>{step.subtitle}</span>
                </div>
                {i < PIPELINE_STEPS.length - 1 && (
                  <ArrowRight className="h-3 w-3 flex-shrink-0 mx-1" style={{ color: 'var(--lt-border-hover)' }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
