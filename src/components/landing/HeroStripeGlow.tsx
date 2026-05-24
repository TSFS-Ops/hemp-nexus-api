import { ArrowRight, ChevronRight, ShieldCheck, Globe2, Database } from "lucide-react";

interface HeroStripeGlowProps {
  onGetStarted: () => void;
  onContactSales?: () => void;
}

export function HeroStripeGlow({ onGetStarted, onContactSales }: HeroStripeGlowProps) {
  return (
    <section className="relative overflow-hidden bg-card">
      {/* Airy emerald/mint mesh gradient with indigo aurora accent for tonal depth */}
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
        {/* Indigo aurora, bottom-left, sparse - adds 'developer/cryptography' tonal weight */}
        <div
          className="absolute -bottom-24 -left-40 w-[680px] h-[680px] rounded-full opacity-35 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(231 70% 78% / 0.5) 0%, hsl(231 70% 78% / 0) 70%)",
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
        {/* Indigo whisper, top-right offset - pairs with bottom-left for diagonal aurora rhythm */}
        <div
          className="absolute top-40 -right-24 w-[520px] h-[520px] rounded-full opacity-25 blur-3xl"
          style={{
            background:
              "radial-gradient(circle at center, hsl(224 76% 82% / 0.45) 0%, hsl(224 76% 82% / 0) 70%)",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent to-white" />
      </div>

      <div className="relative z-10 max-w-[1180px] mx-auto px-4 sm:px-6 lg:px-8 py-12 md:min-h-[calc(100vh-80px)] md:py-12 flex flex-col justify-center items-center text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[hsl(var(--emerald-muted))] border border-[hsl(var(--emerald)/0.2)] text-xs font-medium text-[hsl(var(--emerald))] mb-6 shadow-sm">
          <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--emerald))] animate-pulse" />
          Izenzo Governance Network
        </div>

        {/* Headline */}
        <h1 className="text-4xl sm:text-5xl lg:text-[68px] font-semibold tracking-tight leading-[1.05] text-foreground max-w-4xl mx-auto mb-6">
          Governance Infrastructure for{" "}
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

        {/* Sub-headline - wider so it wraps to 2 lines on desktop */}
        <p className="text-base sm:text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed mb-10">
          One cryptographic network. Access it via our turnkey Trade Desk, manage risk through the Compliance Profile, or build directly on the API. All backed by mathematically provable execution.
        </p>

        {/* Dual CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center justify-center gap-1.5 px-6 h-12 rounded-md text-sm font-semibold text-white bg-emerald-950 shadow-md hover:bg-emerald-900 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 w-full sm:w-auto"
          >
            Provision Workspace
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={onContactSales}
            className="inline-flex items-center justify-center gap-1 px-5 h-12 rounded-md text-sm font-semibold text-[hsl(var(--emerald))] bg-card/80 backdrop-blur border border-[hsl(var(--emerald)/0.2)] hover:bg-card hover:border-[hsl(var(--emerald)/0.2)] shadow-sm transition-all w-full sm:w-auto"
          >
            Read the Docs
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Network Telemetry & Standards */}
        <div className="mt-16 w-full">
          <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-widest text-center mb-6">
            Platform Architecture & Standards
          </p>
          <div className="relative overflow-hidden max-w-4xl mx-auto">
            <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-white via-white/95 to-transparent z-10 pointer-events-none" />
            <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-white via-white/95 to-transparent z-10 pointer-events-none" />
            <div className="flex animate-[telemetry_28s_linear_infinite] whitespace-nowrap w-max">
              {[0, 1].map((dup) => (
                <div key={dup} className="flex gap-x-12 shrink-0 pr-12">
                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    <div className="w-2 h-2 rounded-full bg-[hsl(var(--emerald))]" />
                    <span className="text-sm font-mono tracking-tight">LEDGER: APPEND-ONLY</span>
                  </div>

                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground/70" strokeWidth={1.75} />
                    <span className="text-sm font-mono tracking-tight">LEDGER: SHA-256</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    <Globe2 className="w-4 h-4 text-muted-foreground/70" strokeWidth={1.75} />
                    <span className="text-sm font-mono tracking-tight">RESIDENCY: POPIA / GDPR</span>
                  </div>
                  <div className="flex items-center gap-3 text-muted-foreground shrink-0">
                    <Database className="w-4 h-4 text-muted-foreground/70" strokeWidth={1.75} />
                    <span className="text-sm font-mono tracking-tight">STATE: ATOMIC</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes telemetry {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  );
}
