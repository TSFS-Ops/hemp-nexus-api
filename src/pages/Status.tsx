import { CheckCircle2 } from "lucide-react";
import { PublicHeader } from "@/components/PublicHeader";

const SERVICES = [
  { name: "API", uptime: "100.000%" },
  { name: "Dashboard", uptime: "99.998%" },
  { name: "Webhooks", uptime: "99.994%" },
  { name: "Match Engine", uptime: "100.000%" },
  { name: "Evidence Ledger", uptime: "100.000%" },
  { name: "Authentication", uptime: "99.999%" },
];

// 90-day mock uptime: 1 = operational, 0 = degraded
function generateBars(): number[] {
  const bars: number[] = [];
  for (let i = 0; i < 90; i++) {
    // Sprinkle a couple of degraded ticks for realism
    bars.push(i === 23 || i === 67 ? 0 : 1);
  }
  return bars;
}

export default function Status() {
  return (
    <div className="min-h-screen bg-card">
      <PublicHeader />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
        <p className="text-[13px] font-medium text-[hsl(var(--emerald))] tracking-wider uppercase mb-3">
          System Status
        </p>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter text-foreground mb-12">
          Platform health
        </h1>

        {/* Banner */}
        <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--emerald)/0.2)] bg-[hsl(var(--emerald-muted))]/60 px-5 py-4 mb-12">
          <CheckCircle2 className="h-5 w-5 text-[hsl(var(--emerald))]" />
          <span className="text-[15px] font-medium text-[hsl(var(--emerald))]">All Systems Operational</span>
          <span className="ml-auto text-[12px] text-[hsl(var(--emerald))]/80">Updated just now</span>
        </div>

        {/* Services */}
        <div className="space-y-6">
          {SERVICES.map((service) => {
            const bars = generateBars();
            return (
              <div
                key={service.name}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-[hsl(var(--emerald))]" />
                    <span className="text-[14px] font-medium text-foreground">{service.name}</span>
                  </div>
                  <span className="text-[12px] text-muted-foreground font-mono">{service.uptime}</span>
                </div>

                {/* 90-day uptime bars */}
                <div className="flex gap-[2px] h-8">
                  {bars.map((b, i) => (
                    <div
                      key={i}
                      className={`flex-1 rounded-[1px] ${
                        b === 1 ? "bg-[hsl(var(--emerald))]/80" : "bg-amber-400"
                      }`}
                      title={`Day ${90 - i}`}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground/70">
                  <span>90 days ago</span>
                  <span>Today</span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-12 text-[13px] text-muted-foreground text-center">
          Subscribe to incident updates by following{" "}
          <a href="#" className="text-[hsl(var(--emerald))] hover:text-[hsl(var(--emerald))] font-medium">
            @izenzo_status
          </a>
          .
        </p>
      </main>
    </div>
  );
}
