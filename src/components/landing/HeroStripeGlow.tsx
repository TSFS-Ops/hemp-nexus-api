import { ArrowRight, ChevronRight, ShieldCheck, Globe2, Database } from "lucide-react";

interface HeroStripeGlowProps {
  onGetStarted: () => void;
  onContactSales?: () => void;
}

/**
 * Aurora blobs describing the background wash. Centralised so the
 * markup stays declarative and the palette can be tuned in one place.
 */
const AURORA = [
  { className: "-top-32 -left-32 w-[760px] h-[760px] opacity-60", color: "152 76% 80% / 0.55" },
  { className: "-top-20 -right-40 w-[680px] h-[680px] opacity-55", color: "166 76% 84% / 0.60" },
  { className: "-bottom-24 -left-40 w-[680px] h-[680px] opacity-35", color: "231 70% 78% / 0.50" },
  { className: "-bottom-44 left-1/4 w-[820px] h-[620px] opacity-45", color: "160 84% 88% / 0.60" },
  { className: "top-40 -right-24 w-[520px] h-[520px] opacity-25",   color: "224 76% 82% / 0.45" },
] as const;

type TelemetryItem = { label: string; icon?: typeof ShieldCheck; dot?: boolean };
const TELEMETRY: TelemetryItem[] = [
  { label: "LEDGER: TAMPER-EVIDENT", dot: true },
  { label: "LEDGER: SHA-256", icon: ShieldCheck },
  { label: "REGION: SINGLE APPROVED POLICY", icon: Globe2 },
  { label: "STATE: ATOMIC", icon: Database },
];

export function HeroStripeGlow({ onGetStarted, onContactSales }: HeroStripeGlowProps) {
  return (
    <section className="relative isolate overflow-hidden bg-card">
      {/* Aurora mesh — emerald/mint with indigo counterpoint */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {AURORA.map((blob, i) => (
          <div
            key={i}
            className={`absolute rounded-full blur-3xl ${blob.className}`}
            style={{ background: `radial-gradient(circle at center, hsl(${blob.color}) 0%, transparent 70%)` }}
          />
        ))}
        <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-b from-transparent to-card" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-[1180px] flex-col items-center justify-center px-4 py-12 text-center sm:px-6 lg:px-8 md:min-h-[calc(100vh-80px)]">
        {/* Eyebrow badge */}
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[hsl(var(--emerald)/0.2)] bg-[hsl(var(--emerald-muted))] px-3.5 py-1.5 text-xs font-medium text-[hsl(var(--emerald))] shadow-sm">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[hsl(var(--emerald))]" />
          Izenzo Governance Network
        </div>

        {/* Headline */}
        <h1 className="mx-auto mb-6 max-w-4xl text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl lg:text-[68px]">
          Governance Infrastructure for{" "}
          <span
            className="bg-clip-text text-transparent"
            style={{ backgroundImage: "linear-gradient(135deg, hsl(var(--emerald)) 0%, hsl(174 72% 42%) 100%)" }}
          >
            Institutional Trade.
          </span>
        </h1>

        {/* Sub-headline */}
        <p className="mx-auto mb-10 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          One cryptographic network. Access it via our turnkey Trade Desk, manage risk through the Compliance Profile,
          or build directly on the API. All backed by hash-sealed, independently verifiable execution.
        </p>

        {/* Dual CTAs */}
        <div className="flex w-full flex-col items-center justify-center gap-3 sm:w-auto sm:flex-row">
          <button
            onClick={onGetStarted}
            className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-md bg-[hsl(var(--emerald))] px-6 text-sm font-semibold text-primary-foreground shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-[hsl(var(--emerald-bright))] hover:shadow-lg sm:w-auto"
          >
            Provision Workspace
            <ArrowRight className="h-4 w-4" />
          </button>
          <button
            onClick={onContactSales}
            className="inline-flex h-12 w-full items-center justify-center gap-1 rounded-md border border-[hsl(var(--emerald)/0.2)] bg-card/80 px-5 text-sm font-semibold text-[hsl(var(--emerald))] shadow-sm backdrop-blur transition-all hover:bg-card sm:w-auto"
          >
            Read the Docs
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Telemetry marquee */}
        <div className="mt-16 w-full">
          <p className="mb-6 text-center text-xs font-semibold uppercase tracking-widest text-muted-foreground/70">
            Platform Architecture & Standards
          </p>
          <div className="relative mx-auto max-w-4xl overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
            <div className="flex w-max animate-[telemetry_28s_linear_infinite] whitespace-nowrap">
              {[0, 1].map((dup) => (
                <div key={dup} className="flex shrink-0 gap-x-12 pr-12" aria-hidden={dup === 1}>
                  {TELEMETRY.map(({ icon: Icon, label, dot }) => (
                    <div key={label} className="flex shrink-0 items-center gap-3 text-muted-foreground">
                      {dot ? (
                        <span className="h-2 w-2 rounded-full bg-[hsl(var(--emerald))]" />
                      ) : Icon ? (
                        <Icon className="h-4 w-4 text-muted-foreground/70" strokeWidth={1.75} />
                      ) : null}
                      <span className="font-mono text-sm tracking-tight">{label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes telemetry {
          to { transform: translateX(-50%); }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-\\[telemetry_28s_linear_infinite\\] { animation: none; }
        }
      `}</style>
    </section>
  );
}
