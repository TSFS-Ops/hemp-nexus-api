import { ArrowRight, Sprout, Pickaxe, Wheat, Leaf, Zap, Package } from "lucide-react";
import { HOSTNAMES } from "@/lib/constants";

/**
 * Holding page served on trade.izenzo.co.za.
 *
 * trade.izenzo.co.za is reserved for future Izenzo commodity marketplace
 * verticals. The live authenticated console lives on api.trade.izenzo.co.za
 * and must not be served from this host. This page therefore explains the
 * reservation and soft-gates visitors to the live console.
 */
export function MarketplaceHolding() {
  const consoleUrl = `https://${HOSTNAMES.CONSOLE}`;
  const publicUrl = `https://${HOSTNAMES.PUBLIC_WWW}`;

  const verticals = [
    { icon: Sprout, label: "Cannabis" },
    { icon: Pickaxe, label: "Minerals" },
    { icon: Wheat, label: "Agriculture" },
    { icon: Leaf, label: "Carbon" },
    { icon: Zap, label: "Energy" },
    { icon: Package, label: "Other commodities" },
  ];

  return (
    <div
      className="min-h-screen flex flex-col bg-white"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}
    >
      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 py-16">
        <div className="max-w-2xl w-full">
          {/* Brand mark */}
          <div className="flex items-center gap-2 mb-10">
            <div className="w-8 h-8 rounded-md flex items-center justify-center bg-emerald-950">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            </div>
            <span className="text-[17px] font-semibold tracking-tight text-slate-900">Izenzo</span>
          </div>

          {/* Status pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-slate-200 bg-slate-50 text-[11px] font-medium uppercase tracking-wider text-slate-600 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Reserved for future use
          </div>

          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 leading-tight">
            This domain is reserved for future Izenzo commodity marketplaces.
          </h1>

          <p className="mt-5 text-base text-slate-600 leading-relaxed">
            <span className="font-mono text-[13px] bg-slate-100 px-1.5 py-0.5 rounded">
              {HOSTNAMES.MARKETPLACE}
            </span>{" "}
            is being held for upcoming Izenzo verticals. It is not the live trading console
            and does not host POIs, WaDs, billing, admin or developer tools.
          </p>

          {/* Verticals */}
          <div className="mt-8">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">
              Planned verticals
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {verticals.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-slate-200 bg-white text-sm text-slate-700"
                >
                  <Icon className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span className="truncate">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* CTAs */}
          <div className="mt-10 flex flex-col sm:flex-row gap-3">
            <a
              href={consoleUrl}
              className="inline-flex items-center justify-center gap-1.5 px-5 h-11 text-sm font-semibold rounded-md text-white bg-emerald-950 hover:bg-emerald-900 shadow-sm transition-colors"
            >
              Go to live console
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href={publicUrl}
              className="inline-flex items-center justify-center gap-1.5 px-5 h-11 text-sm font-medium rounded-md text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors"
            >
              Visit izenzo.co.za
            </a>
          </div>

          <div className="mt-10 pt-6 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
            For POIs, WaDs, billing, admin, compliance, the trading desk, the developer
            centre and execution workflows, sign in at{" "}
            <a
              href={consoleUrl}
              className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
            >
              {HOSTNAMES.CONSOLE}
            </a>
            . For product information, visit{" "}
            <a
              href={publicUrl}
              className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
            >
              {HOSTNAMES.PUBLIC_WWW}
            </a>
            .
          </div>
        </div>
      </main>

      <footer className="w-full py-6 border-t border-slate-100">
        <div className="container mx-auto px-4 text-center">
          <p className="text-[11px] text-slate-500 tracking-wide">
            Izenzo is the trading name of Starfair162 (Pty) Ltd Reg: 2018 / 331720 / 07.
          </p>
        </div>
      </footer>
    </div>
  );
}

export default MarketplaceHolding;
