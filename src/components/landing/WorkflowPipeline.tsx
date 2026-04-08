/**
 * 6-step trade workflow pipeline - ultra-premium Bloomberg terminal style.
 * Clean header, no toggle. Emerald-highlighted Finalise step.
 */

import { ArrowRight, Search, ShieldCheck, Eye, FileText, CheckCircle2, Lock } from "lucide-react";

const PIPELINE_STEPS = [
  { label: "Find Partner", subtitle: "Search & discover", Icon: Search },
  { label: "Identity Check", subtitle: "Verify & validate", Icon: ShieldCheck },
  { label: "Initial Review", subtitle: "Assess & evaluate", Icon: Eye },
  { label: "Draft Request", subtitle: "Structure the deal", Icon: FileText },
  { label: "Commit", subtitle: "Confirm intent", Icon: CheckCircle2 },
  { label: "Finalise", subtitle: "Signed Deal", Icon: Lock },
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
          How it works - From Discovery to Completion
        </span>
      </div>

      {/* 6-step pipeline */}
      <div className="overflow-x-auto scrollbar-hide">
        <div className="flex items-center sm:justify-between gap-1" style={{ minWidth: '650px' }}>
          {PIPELINE_STEPS.map((step, i) => {
            const isFinal = i === PIPELINE_STEPS.length - 1;
            return (
              <div key={step.label} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className="flex flex-col items-center text-center min-w-[90px] px-2 py-3 rounded-xl transition-all duration-200"
                  style={isFinal ? {
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid var(--lt-emerald-dark)',
                  } : {}}
                >
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center mb-2"
                    style={{
                      border: isFinal
                        ? '1.5px solid var(--lt-emerald)'
                        : '1px solid var(--lt-border-hover)',
                      backgroundColor: isFinal
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'var(--lt-panel)',
                    }}
                  >
                    <step.Icon
                      style={{
                        color: isFinal ? 'var(--lt-emerald)' : 'var(--lt-text)',
                        width: '18px',
                        height: '18px',
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold leading-tight" style={{ color: isFinal ? 'var(--lt-emerald)' : 'var(--lt-text)' }}>{step.label}</span>
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
