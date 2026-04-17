/**
 * Bento-style 3x3 feature grid mapping the platform's 9-step trade lifecycle.
 * Clean white cards, subtle shadows, minimalist Lucide icons, lift on hover.
 */

import {
  FileText,
  ClipboardList,
  Upload,
  Search,
  ListChecks,
  Eye,
  Handshake,
  ShieldCheck,
  Award,
  type LucideIcon,
} from "lucide-react";

type Step = {
  label: string;
  description: string;
  Icon: LucideIcon;
};

const STEPS: Step[] = [
  {
    label: "Trade Interest",
    description: "Capture buy- or sell-side intent. Structured signal, not a chat thread.",
    Icon: FileText,
  },
  {
    label: "Details",
    description: "Bind commercial terms, jurisdiction and entity. Every field is auditable.",
    Icon: ClipboardList,
  },
  {
    label: "Upload",
    description: "Attach supporting documents. Stored sealed and tamper-evident from day one.",
    Icon: Upload,
  },
  {
    label: "Search",
    description: "Discover verified counterparties across the registered partner network.",
    Icon: Search,
  },
  {
    label: "Choice",
    description: "Compare candidates with transparent scoring. No black-box rankings.",
    Icon: ListChecks,
  },
  {
    label: "Surface",
    description: "Reveal mutual interest only when both sides clear the governance gate.",
    Icon: Eye,
  },
  {
    label: "Match",
    description: "Formal bilateral creation. Both parties cryptographically committed.",
    Icon: Handshake,
  },
  {
    label: "Proof of Intent",
    description: "Generate the binding pre-execution attestation. The platform's hold-point.",
    Icon: ShieldCheck,
  },
  {
    label: "Evidence",
    description: "Sealed Without-a-Doubt bundle. Bankable, exportable, regulator-ready.",
    Icon: Award,
  },
];

export function WorkflowPipeline() {
  return (
    <section
      className="relative rounded-2xl bg-white border border-slate-200 p-6 sm:p-8"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* Section eyebrow */}
      <div className="mb-6 sm:mb-8">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          The Protocol
        </div>
        <h2 className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
          Nine governance gates. One execution path.
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 max-w-xl">
          Every trade moves through the same sequenced, auditable lifecycle — from interest to sealed evidence.
        </p>
      </div>

      {/* 3x3 Bento grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {STEPS.map((step, i) => (
          <article
            key={step.label}
            className="group relative bg-white border border-slate-200 rounded-xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(15,23,42,0.08)] hover:-translate-y-1 hover:border-slate-300 transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center group-hover:bg-slate-900 group-hover:border-slate-900 transition-colors">
                <step.Icon className="h-[18px] w-[18px] text-slate-700 group-hover:text-white transition-colors" strokeWidth={1.75} />
              </div>
              <span className="text-[11px] font-mono font-semibold text-slate-400 tabular-nums">
                0{i + 1}
              </span>
            </div>
            <h3 className="text-[15px] font-semibold text-slate-900 tracking-tight">
              {step.label}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600 line-clamp-2">
              {step.description}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
