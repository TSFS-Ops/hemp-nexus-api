/**
 * GovernancePlaceholder — shared "Coming Soon" surface for unfinished
 * Governor console routes. Matches the Triage Inbox aesthetic so the sidebar
 * remains coherent while these modules are being built.
 */

import { LucideIcon } from "lucide-react";

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  modules: { code: string; label: string; status: "scoped" | "drafting" | "queued" }[];
  eta: string;
}

export function GovernancePlaceholder({
  eyebrow,
  title,
  description,
  icon: Icon,
  modules,
  eta,
}: Props) {
  return (
    <div className="fixed inset-y-0 left-[260px] right-0 flex flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-12 pt-20 pb-16">
          {/* Eyebrow */}
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-6">
            {eyebrow}
          </p>

          {/* Title row */}
          <div className="flex items-start gap-5 pb-10 border-b border-slate-200">
            <div className="h-12 w-12 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-slate-700" strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
                {title}
              </h1>
              <p className="mt-3 text-sm text-slate-700 leading-relaxed max-w-xl">
                {description}
              </p>
            </div>
          </div>

          {/* Status banner */}
          <div className="mt-10 flex items-center gap-3 rounded-sm border border-amber-200 bg-amber-50/60 px-4 py-3">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden />
            <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-amber-900">
              Under construction · Targeted for {eta}
            </p>
          </div>

          {/* Module manifest */}
          <section className="mt-12">
            <div className="flex items-baseline justify-between pb-3 border-b border-slate-200 mb-6">
              <h2 className="text-base font-medium text-slate-900 tracking-tight">
                Module Manifest
              </h2>
              <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
                {modules.length} planned
              </p>
            </div>

            <ul className="divide-y divide-slate-100 rounded-sm border border-slate-200 bg-white">
              {modules.map((m) => (
                <li
                  key={m.code}
                  className="flex items-center justify-between gap-6 px-5 py-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] tracking-wider text-slate-500 uppercase">
                      {m.code}
                    </p>
                    <p className="mt-1 text-sm text-slate-900 truncate">{m.label}</p>
                  </div>
                  <StatusPill status={m.status} />
                </li>
              ))}
            </ul>
          </section>

          <p className="mt-10 font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
            Build sequence governed by Izenzo platform roadmap
          </p>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "scoped" | "drafting" | "queued" }) {
  const tone =
    status === "drafting"
      ? { ring: "ring-emerald-200", text: "text-emerald-800", bg: "bg-emerald-50" }
      : status === "scoped"
        ? { ring: "ring-slate-300", text: "text-slate-900", bg: "bg-slate-50" }
        : { ring: "ring-slate-200", text: "text-slate-900", bg: "bg-slate-100/70" };

  return (
    <span
      className={`font-mono text-[9px] tracking-[0.2em] uppercase font-medium px-2 py-1 rounded-sm ring-1 ${tone.ring} ${tone.bg} ${tone.text}`}
    >
      {status}
    </span>
  );
}
