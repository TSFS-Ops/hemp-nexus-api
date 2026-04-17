import { ArrowRight, ChevronRight } from "lucide-react";

interface HeroStripeGlowProps {
  onGetStarted: () => void;
  onContactSales?: () => void;
}

const PARTNER_LOGOS = ["NVIDIA", "Amazon", "Ford", "Google", "Siemens", "Shell"];

export function HeroStripeGlow({ onGetStarted, onContactSales }: HeroStripeGlowProps) {
  return (
    <section
      className="relative overflow-hidden bg-white"
      style={{ fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" }}
    >
      {/* Stripe Glow — multi-layered mesh gradient */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute -top-32 -left-24 w-[720px] h-[720px] rounded-full opacity-40 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(238 78% 56% / 0.55) 0%, hsl(238 78% 56% / 0) 70%)",
          }}
        />
        <div
          className="absolute -top-10 -right-40 w-[640px] h-[640px] rounded-full opacity-35 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(158 70% 42% / 0.55) 0%, hsl(158 70% 42% / 0) 70%)",
          }}
        />
        <div
          className="absolute -bottom-40 left-1/3 w-[800px] h-[600px] rounded-full opacity-30 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(215 40% 35% / 0.55) 0%, hsl(215 40% 35% / 0) 70%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />
      </div>

      <div className="relative z-10 max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-32 sm:pt-32 sm:pb-40 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 backdrop-blur border border-slate-200/80 text-xs font-medium text-slate-600 mb-8 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Pre-Execution Governance Protocol
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-[68px] font-semibold tracking-tight leading-[1.05] text-slate-900 max-w-4xl mx-auto">
          Sovereign Infrastructure for{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(135deg, hsl(238 78% 56%) 0%, hsl(158 70% 42%) 100%)",
            }}
          >
            Global Trade.
          </span>
        </h1>

        <p className="mt-8 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Discover partners, automate compliance, and execute trades with cryptographic
          certainty. The world's first pre-execution governance protocol.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center justify-center gap-1.5 px-6 h-11 rounded-md text-sm font-semibold text-white bg-gradient-to-b from-slate-800 to-slate-950 shadow-md hover:shadow-lg hover:from-slate-700 hover:to-slate-900 transition-all w-full sm:w-auto"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={onContactSales}
            className="inline-flex items-center justify-center gap-1 px-5 h-11 rounded-md text-sm font-semibold text-slate-800 bg-white/80 backdrop-blur border border-slate-200 hover:bg-white hover:border-slate-300 shadow-sm transition-all w-full sm:w-auto"
          >
            Contact Sales
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-20">
          <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-slate-400 mb-6">
            Trusted by Institutional Partners
          </p>
          <div className="relative overflow-hidden max-w-3xl mx-auto">
            <div className="absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />
            <div className="flex gap-12 sm:gap-16 animate-[ticker_32s_linear_infinite] whitespace-nowrap">
              {[...PARTNER_LOGOS, ...PARTNER_LOGOS].map((name, i) => (
                <span
                  key={`${name}-${i}`}
                  className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-400/80 hover:text-slate-600 transition-colors shrink-0"
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ticker {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
