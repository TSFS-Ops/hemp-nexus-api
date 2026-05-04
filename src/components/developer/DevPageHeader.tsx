/**
 * DevPageHeader
 *
 * A small, consistent strip that sits at the top of every Developer Centre
 * tab body. It carries:
 *
 *   - "Who this page is for" (one line, plain English)
 *   - The viewer's role and API scope context (so an operator knows what
 *     they themselves are allowed to do here)
 *   - The support contact (api@izenzo.co.za) — surfaced on every tab,
 *     not only buried in the Integration Docs footer
 *
 * Keep this dumb and presentational. No data fetching, no side effects.
 */

import { useAuth } from "@/contexts/AuthContext";
import { Mail, UserCircle2 } from "lucide-react";

interface Props {
  audience: string;
}

export function DevPageHeader({ audience }: Props) {
  const { roles, user } = useAuth();
  const roleLabel = roles.length > 0 ? roles.join(" · ") : "no role assigned";

  return (
    <section
      className="rounded-sm border border-slate-800 bg-slate-900/30 px-5 py-3 flex flex-wrap items-center justify-between gap-3"
      style={{ fontFamily: "Inter, sans-serif" }}
    >
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-500">
          Who this page is for
        </div>
        <p className="text-[13px] text-slate-200 leading-snug mt-0.5">{audience}</p>
      </div>

      <div className="flex items-center gap-5 shrink-0">
        <div className="flex items-center gap-2">
          <UserCircle2 className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
          <div className="text-[11.5px] leading-tight">
            <div className="text-slate-100 font-mono">{user?.email ?? "signed out"}</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-400">
              {roleLabel}
            </div>
          </div>
        </div>

        <a
          href="mailto:api@izenzo.co.za"
          className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300 hover:text-emerald-400 transition-colors"
        >
          <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
          api@izenzo.co.za
        </a>
      </div>
    </section>
  );
}
