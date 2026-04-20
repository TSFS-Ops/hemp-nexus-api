/**
 * GovernancePage, shared layout shell for Governor sub-surfaces.
 * Maintains the "ink-on-paper" Izenzo aesthetic: white surface,
 * hairline borders, JetBrains Mono for IDs/eyebrows.
 */

import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface Props {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  meta?: { label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }[];
  children: ReactNode;
}

export function GovernancePage({ eyebrow, title, description, icon: Icon, meta, children }: Props) {
  return (
    <div className="fixed inset-y-0 inset-x-0 md:left-[260px] md:right-0 flex flex-col bg-white pb-16 md:pb-0">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl px-6 md:px-12 pt-10 md:pt-14 pb-16">
          {/* Eyebrow */}
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-6">
            {eyebrow}
          </p>

          {/* Title row */}
          <div className="flex items-start gap-5 pb-8 border-b border-slate-200">
            <div className="h-12 w-12 rounded-md border border-slate-200 bg-slate-50 flex items-center justify-center shrink-0">
              <Icon className="h-5 w-5 text-slate-700" strokeWidth={1.5} />
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-semibold text-slate-900 tracking-tight leading-[1.1]">
                {title}
              </h1>
              <p className="mt-3 text-sm text-slate-700 leading-relaxed max-w-2xl">
                {description}
              </p>
            </div>
            {meta && (
              <div className="hidden md:flex flex-col gap-2 text-right">
                {meta.map((m) => (
                  <div key={m.label}>
                    <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-slate-400">
                      {m.label}
                    </p>
                    <p
                      className={[
                        "font-mono text-sm tracking-tight mt-0.5",
                        m.tone === "good" && "text-emerald-700",
                        m.tone === "warn" && "text-amber-700",
                        m.tone === "bad" && "text-rose-700",
                        (!m.tone || m.tone === "neutral") && "text-slate-900",
                      ].filter(Boolean).join(" ")}
                    >
                      {m.value}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
