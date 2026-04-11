/**
 * Trade workflow pipeline — 9 steps matching the platform's actual lifecycle.
 * Responsive: compact 2-column grid on mobile, horizontal row on desktop.
 */

import { ArrowRight, FileText, Search, ShieldCheck, Eye, Users, UserCheck, Handshake, Award, BookOpen } from "lucide-react";
import { motion } from "framer-motion";

const PIPELINE_STEPS = [
  { label: "Bid / Offer", subtitle: "Intent capture", Icon: FileText },
  { label: "Details", subtitle: "Entity & terms", Icon: BookOpen },
  { label: "Upload Docs", subtitle: "Supporting files", Icon: FileText },
  { label: "Search", subtitle: "Find partners", Icon: Search },
  { label: "Choice", subtitle: "Select from results", Icon: Users },
  { label: "Surface", subtitle: "Reveal match", Icon: UserCheck },
  { label: "Match", subtitle: "Formal creation", Icon: Handshake },
  { label: "Generate POI", subtitle: "Proof of intent", Icon: ShieldCheck },
  { label: "Signed Deal", subtitle: "Evidence bundle", Icon: Award },
];

export function WorkflowPipeline() {
  return (
    <div
      className="rounded-2xl p-4 sm:p-5"
      style={{
        backgroundColor: 'rgba(15, 20, 32, 0.5)',
        border: '1px solid var(--lt-border)',
        backdropFilter: 'blur(8px)',
      }}
    >
      {/* Section label */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--lt-emerald)' }} />
        <span className="text-[11px] font-mono uppercase tracking-wider font-semibold" style={{ color: 'var(--lt-text-muted)' }}>
          How it works — 9 steps
        </span>
      </div>

      {/* Desktop: horizontal row */}
      <div className="hidden lg:flex items-center justify-between gap-0.5">
        {PIPELINE_STEPS.map((step, i) => {
          const isFinal = i === PIPELINE_STEPS.length - 1;
          return (
            <motion.div
              key={step.label}
              className="flex items-center gap-0.5 flex-shrink-0"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: i * 0.08, ease: "easeOut" }}
            >
              <StepItem step={step} isFinal={isFinal} stepNumber={i + 1} />
              {i < PIPELINE_STEPS.length - 1 && (
                <ArrowRight className="h-3 w-3 flex-shrink-0 mx-0.5" style={{ color: 'var(--lt-border-hover)' }} />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Mobile/Tablet: compact 3-column grid */}
      <div className="lg:hidden grid grid-cols-3 gap-2">
        {PIPELINE_STEPS.map((step, i) => {
          const isFinal = i === PIPELINE_STEPS.length - 1;
          return (
            <motion.div
              key={step.label}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.05, ease: "easeOut" }}
            >
              <div
                className="flex flex-col items-center text-center gap-1.5 px-2 py-2.5 rounded-xl"
                style={isFinal ? {
                  backgroundColor: 'rgba(16, 185, 129, 0.08)',
                  border: '1px solid var(--lt-emerald-dark)',
                } : {
                  backgroundColor: 'var(--lt-panel)',
                  border: '1px solid var(--lt-border)',
                }}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    border: isFinal
                      ? '1.5px solid var(--lt-emerald)'
                      : '1px solid var(--lt-border-hover)',
                    backgroundColor: isFinal
                      ? 'rgba(16, 185, 129, 0.15)'
                      : 'transparent',
                  }}
                >
                  <step.Icon
                    style={{
                      color: isFinal ? 'var(--lt-emerald)' : 'var(--lt-text)',
                      width: '12px',
                      height: '12px',
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold leading-tight block" style={{ color: isFinal ? 'var(--lt-emerald)' : 'var(--lt-text)' }}>
                    {i + 1}. {step.label}
                  </span>
                  <span className="text-[9px] font-medium leading-tight block" style={{ color: 'var(--lt-text-dim)' }}>
                    {step.subtitle}
                  </span>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function StepItem({ step, isFinal, stepNumber }: { step: typeof PIPELINE_STEPS[number]; isFinal: boolean; stepNumber: number }) {
  return (
    <div
      className="flex flex-col items-center text-center min-w-[70px] px-1.5 py-2.5 rounded-xl transition-all duration-200"
      style={isFinal ? {
        backgroundColor: 'rgba(16, 185, 129, 0.08)',
        border: '1px solid var(--lt-emerald-dark)',
      } : {}}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center mb-1.5"
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
            width: '16px',
            height: '16px',
          }}
        />
      </div>
      <span className="text-[10px] font-semibold leading-tight" style={{ color: isFinal ? 'var(--lt-emerald)' : 'var(--lt-text)' }}>{stepNumber}. {step.label}</span>
      <span className="text-[9px] font-medium leading-tight mt-0.5" style={{ color: 'var(--lt-text-dim)' }}>{step.subtitle}</span>
    </div>
  );
}
