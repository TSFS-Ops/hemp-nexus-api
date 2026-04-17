import { Link } from "react-router-dom";
import { ArrowRight, BookOpen, Code, Boxes, Zap } from "lucide-react";
import { DocsLayout } from "./DocsLayout";

const QUICK_LINKS = [
  {
    to: "/docs/quickstart",
    icon: Zap,
    title: "Quickstart",
    desc: "Make your first authenticated API call in under five minutes.",
  },
  {
    to: "/docs/api",
    icon: Code,
    title: "API Reference",
    desc: "Browse every endpoint, parameter and response schema.",
  },
  {
    to: "/docs/sdks",
    icon: Boxes,
    title: "SDKs & Libraries",
    desc: "Official Node.js, Python and Go clients.",
  },
  {
    to: "/docs/authentication",
    icon: BookOpen,
    title: "Authentication",
    desc: "API keys, scopes and signed-request verification.",
  },
];

export default function DocsIndex() {
  return (
    <DocsLayout>
      <div className="max-w-3xl">
        <p className="text-[13px] font-medium text-emerald-600 tracking-wider uppercase mb-3">
          Documentation
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-slate-900 mb-5">
          Izenzo Documentation
        </h1>
        <p className="text-lg text-slate-500 leading-relaxed mb-12">
          Everything you need to integrate cryptographic trade governance, automated KYB, and
          instant match execution into your institutional systems.
        </p>

        <div className="grid sm:grid-cols-2 gap-4 mb-16">
          {QUICK_LINKS.map(({ to, icon: Icon, title, desc }) => (
            <Link
              key={to}
              to={to}
              className="group block p-6 rounded-xl border border-slate-100 bg-white hover:border-slate-200 hover:shadow-sm transition-all"
            >
              <Icon className="h-5 w-5 text-emerald-600 mb-4" strokeWidth={1.75} />
              <h3 className="text-[15px] font-semibold text-slate-900 mb-1.5 tracking-tight">
                {title}
              </h3>
              <p className="text-[13.5px] text-slate-500 leading-relaxed mb-4">{desc}</p>
              <span className="inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600 group-hover:gap-1.5 transition-all">
                View <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          ))}
        </div>

        <section className="border-t border-slate-100 pt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-3">
            Platform concepts
          </h2>
          <p className="text-slate-500 leading-relaxed mb-6">
            Izenzo is built around three primitives: <strong className="text-slate-900 font-medium">Counterparties</strong> (verified
            organisations), <strong className="text-slate-900 font-medium">Matches</strong> (bilateral trade intent), and{" "}
            <strong className="text-slate-900 font-medium">Evidence Packs</strong> (cryptographically sealed audit records).
            Every state transition is signed, timestamped and append-only.
          </p>
          <Link
            to="/docs/quickstart"
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-emerald-600 hover:text-emerald-700"
          >
            Start with the Quickstart <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </DocsLayout>
  );
}
