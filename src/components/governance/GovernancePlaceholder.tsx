/**
 * GovernancePlaceholder, professional empty state for governance surfaces
 * that have no active records to display. No "under construction" copy:
 * if a surface is mounted, it is shipped; emptiness reflects an empty queue.
 */

import { LucideIcon, Inbox } from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  eyebrow?: string;
  title?: string;
  description?: string;
  icon?: LucideIcon;
  /** Retained for backwards compatibility; no longer rendered. */
  modules?: { code: string; label: string; status: "scoped" | "drafting" | "queued" }[];
  /** Retained for backwards compatibility; no longer rendered. */
  eta?: string;
}

export function GovernancePlaceholder({
  eyebrow = "Governance",
  title = "No active records",
  description = "No active data for this governance surface. Please check the Triage queue or Risk items for pending actions.",
  icon: Icon = Inbox,
}: Props) {
  return (
    <div className="fixed inset-y-0 left-[260px] right-0 flex flex-col bg-white">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl px-12 pt-20 pb-16">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-slate-500 mb-6">
            {eyebrow}
          </p>

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

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              to="/governance/triage"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-900 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors"
            >
              Open Triage Queue
            </Link>
            <Link
              to="/governance/health"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-sm border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-mono text-[10px] tracking-[0.2em] uppercase transition-colors"
            >
              Review Risk Items
            </Link>
          </div>

          <p className="mt-10 font-mono text-[10px] tracking-[0.25em] uppercase text-slate-400">
            Records will appear here as they enter the governance pipeline
          </p>
        </div>
      </div>
    </div>
  );
}
