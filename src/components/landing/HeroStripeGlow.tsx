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
          Pre-Execution Governance Protocol
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-[68px] font-semibold tracking-tight leading-[1.05] text-slate-900 max-w-4xl mx-auto">
          Trade infrastructure to{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(135deg, hsl(160 84% 30%) 0%, hsl(174 72% 42%) 100%)",
            }}
          >
            prove every deal.
          </span>
        </h1>

        {/* Sub-headline — extra breathing room */}
        <p className="mt-12 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed">
          Discover Trading Partners. Validate Intent. Execute with Confidence.
        </p>

        {/* Dual CTAs */}
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center justify-center gap-1.5 px-6 h-12 rounded-md text-sm font-semibold text-white bg-emerald-950 shadow-md hover:bg-emerald-900 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 w-full sm:w-auto"
          >
            Get Started
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={onContactSales}
            className="inline-flex items-center justify-center gap-1 px-5 h-12 rounded-md text-sm font-semibold text-emerald-900 bg-white/80 backdrop-blur border border-emerald-100 hover:bg-white hover:border-emerald-200 shadow-sm transition-all w-full sm:w-auto"
          >
            Contact Sales
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Social proof */}
        <div className="mt-24">
          <p className="text-[11px] font-semibold tracking-[0.18em] uppercase text-slate-400 mb-7">
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
