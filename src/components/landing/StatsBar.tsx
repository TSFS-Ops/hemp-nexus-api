/**
 * Stats bar — Stripe-style 4-column metrics strip.
 * Platform capability stats (verified, not aspirational).
 */

const STATS = [
  {
    value: "4",
    label: "Core workflow stages: Search, Match, Confirm Intent, Evidence Pack",
  },
  {
    value: "SHA-256",
    label: "Cryptographic hash chain linking every event in the audit trail",
  },
  {
    value: "6",
    label: "Governance checkpoints enforced per transaction lifecycle",
  },
  {
    value: "< 500ms",
    label: "Median API response time for counterparty search queries",
  },
];

export function StatsBar() {
  return (
    <section className="relative py-16 sm:py-20 px-4 sm:px-6 border-t border-border bg-accent/20 overflow-hidden">
      {/* Gradient accent */}
      <div
        className="absolute top-0 right-0 w-1/2 h-full pointer-events-none opacity-[0.04]"
        aria-hidden="true"
        style={{ background: `linear-gradient(135deg, transparent 0%, hsl(var(--primary)) 100%)` }}
      />
      <div className="max-w-[1280px] mx-auto relative z-10">
        <div className="mb-10 animate-fade-up">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary mb-3 block">
            Platform at Scale
          </span>
          <h2 className="text-foreground tracking-tighter">
            The backbone of governed trade.
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-0 border border-border bg-background">
          {STATS.map((stat, i) => (
            <div
              key={i}
              className={`p-5 sm:p-6 animate-fade-up
                         ${i > 0 ? "lg:border-l border-border" : ""}
                         ${i === 1 ? "border-l border-border" : ""}
                         ${i >= 2 ? "border-t lg:border-t-0 border-border" : ""}
                         ${i === 3 ? "border-l border-border" : ""}`}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="text-[28px] sm:text-[32px] font-bold text-foreground tracking-tighter block mb-2 font-sans">
                {stat.value}
              </span>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
