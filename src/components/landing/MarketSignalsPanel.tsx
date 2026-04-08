/**
 * Right-hand market information panel — live market signals summary.
 * Complements the bottom CommodityTicker (Section 4 decision: A & B).
 */

import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const MARKET_SIGNALS = [
  { asset: "Copper", price: "$9,842", unit: "/MT", trend: "up" as const, change: "+1.2%", corridor: "Zambia → China" },
  { asset: "Lithium (LCE)", price: "$12,150", unit: "/MT", trend: "down" as const, change: "−3.1%", corridor: "DRC → Europe" },
  { asset: "Soybeans", price: "$498", unit: "/MT", trend: "up" as const, change: "+0.8%", corridor: "Brazil → E. Africa" },
  { asset: "Carbon Credits", price: "$14.20", unit: "/VCU", trend: "flat" as const, change: "0.0%", corridor: "Kenya" },
  { asset: "Cobalt", price: "$33,200", unit: "/MT", trend: "up" as const, change: "+2.4%", corridor: "DRC → Japan" },
];

function TrendIcon({ trend }: { trend: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="h-3 w-3 text-signal-verified" />;
  if (trend === "down") return <TrendingDown className="h-3 w-3 text-destructive" />;
  return <Minus className="h-3 w-3 text-muted-foreground/40" />;
}

export function MarketSignalsPanel() {
  return (
    <div className="border border-border lg:border-0 lg:border-b lg:border-border bg-background">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-mono font-medium uppercase tracking-widest text-muted-foreground">
            Market Signals
          </span>
        </div>
        <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/40">
          Illustrative
        </span>
      </div>

      {/* Signal rows */}
      <div>
        {MARKET_SIGNALS.map((signal) => (
          <div
            key={signal.asset}
            className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-0
                       hover:bg-accent/20 transition-colors duration-200 cursor-default"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium text-foreground">{signal.asset}</span>
                <TrendIcon trend={signal.trend} />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground/40">{signal.corridor}</span>
            </div>
            <div className="text-right flex-shrink-0">
              <span className="text-[11px] font-mono font-medium text-foreground">{signal.price}</span>
              <span className="text-[9px] font-mono text-muted-foreground/40">{signal.unit}</span>
              <span className={`block text-[9px] font-mono ${
                signal.trend === "up" ? "text-signal-verified" : signal.trend === "down" ? "text-destructive" : "text-muted-foreground/40"
              }`}>
                {signal.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border">
        <p className="text-[8px] font-mono text-muted-foreground/25 uppercase tracking-widest">
          Illustrative pricing · Not live data · Not financial advice
        </p>
      </div>
    </div>
  );
}
