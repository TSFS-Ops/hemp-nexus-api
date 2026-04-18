import { ArrowRight, ChevronRight, ShieldCheck, Globe2, Database } from "lucide-react";

interface HeroStripeGlowProps {
  onGetStarted: () => void;
  onContactSales?: () => void;
}

export function HeroStripeGlow({ onGetStarted, onContactSales }: HeroStripeGlowProps) {
  return (
    <section
      className="relative overflow-hidden bg-white"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}
    >
      {/* Airy emerald/mint mesh gradient */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {/* Emerald wash, top-left */}
        <div
          className="absolute -top-32 -left-32 w-[760px] h-[760px] rounded-full opacity-60 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(152 76% 80% / 0.55) 0%, hsl(152 76% 80% / 0) 70%)",
          }}
        />
        {/* Mint wash, top-right */}
        <div
          className="absolute -top-20 -right-40 w-[680px] h-[680px] rounded-full opacity-55 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(166 76% 84% / 0.6) 0%, hsl(166 76% 84% / 0) 70%)",
          }}
        />
        {/* Soft teal wash, bottom-center */}
        <div
          className="absolute -bottom-44 left-1/4 w-[820px] h-[620px] rounded-full opacity-45 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(160 84% 88% / 0.6) 0%, hsl(160 84% 88% / 0) 70%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent to-white" />
      </div>

      <div className="relative z-10 max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 pt-32 pb-40 sm:pt-44 sm:pb-52 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-xs font-medium text-emerald-800 mb-12 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Izenzo Governance Network
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-[68px] font-semibold tracking-tight leading-[1.05] text-slate-900 max-w-4xl mx-auto">
          The Governance Infrastructure for{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(135deg, hsl(160 84% 30%) 0%, hsl(174 72% 42%) 100%)",
            }}
          >
            Institutional Trade.
          </span>
        </h1>

        {/* Sub-headline, extra breathing room */}
        <p className="mt-12 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          One cryptographic network. Access it via our turnkey Trade Desk, manage risk through the Compliance Profile, or build directly on the API. All backed by mathematically provable execution.
        </p>

        {/* Dual CTAs */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center justify-center gap-1.5 px-6 h-12 rounded-md text-sm font-semibold text-white bg-emerald-950 shadow-md hover:bg-emerald-900 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 w-full sm:w-auto"
          >
            Provision Workspace
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={onContactSales}
            className="inline-flex items-center justify-center gap-1 px-5 h-12 rounded-md text-sm font-semibold text-emerald-900 bg-white/80 backdrop-blur border border-emerald-100 hover:bg-white hover:border-emerald-200 shadow-sm transition-all w-full sm:w-auto"
          >
            Read the Docs
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Network Telemetry & Standards */}
        <div className="mt-24">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest text-center mb-8">
            Platform Architecture & Standards
          </p>
          <div className="flex flex-wrap justify-center items-center gap-x-12 gap-y-6">
            <div className="flex items-center gap-3 text-slate-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-mono tracking-tight">SYSTEM: OPERATIONAL</span>
            </div>
            <div className="flex items-center gap-3 text-slate-500">
              <ShieldCheck className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
              <span className="text-sm font-mono tracking-tight">LEDGER: SHA-256</span>
            </div>
            <div className="flex items-center gap-3 text-slate-500">
              <Globe2 className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
              <span className="text-sm font-mono tracking-tight">RESIDENCY: POPIA / GDPR</span>
            </div>
            <div className="flex items-center gap-3 text-slate-500">
              <Database className="w-4 h-4 text-slate-400" strokeWidth={1.75} />
              <span className="text-sm font-mono tracking-tight">STATE: ATOMIC</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
