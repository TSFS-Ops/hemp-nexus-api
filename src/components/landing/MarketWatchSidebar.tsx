/**
 * Right-hand Market Watch sidebar — commodity prices + latest news.
 * Bloomberg-terminal style persistent sidebar for the landing dashboard.
 */

import { TrendingUp, TrendingDown, ArrowRight } from "lucide-react";

const MARKET_DATA = [
  { asset: "Gold", price: "1,945.20", change: "+0.62%", trend: "up" as const },
  { asset: "Oil (Brent)", price: "81.23", change: "-0.41%", trend: "down" as const },
  { asset: "Carbon Credits", price: "73.15", change: "+1.21%", trend: "up" as const },
  { asset: "USD/ZAR", price: "18.72", change: "-0.34%", trend: "down" as const },
  { asset: "Copper", price: "8,923.11", change: "+0.10%", trend: "up" as const },
];

const LATEST_NEWS = [
  { headline: "New compliance rule approved", time: "5 min ago" },
  { headline: "Infrastructure deal signed", time: "18 min ago" },
  { headline: "Carbon market hits record volume", time: "35 min ago" },
  { headline: "Regulators align on data standards", time: "1 hour ago" },
];

export function MarketWatchSidebar() {
  return (
    <div className="border-l border-border bg-background flex flex-col h-full">
      {/* Market Watch */}
      <div className="flex-shrink-0">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
            <span className="text-[11px] font-semibold text-foreground tracking-tight">Market Watch</span>
          </div>
        </div>
        <div>
          {MARKET_DATA.map((item) => (
            <div
              key={item.asset}
              className="flex items-center justify-between px-4 py-2.5 border-b border-border
                         hover:bg-accent/20 transition-colors duration-200"
            >
              <span className="text-[11px] text-foreground font-medium">{item.asset}</span>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono font-medium text-foreground">{item.price}</span>
                <span className={`text-[10px] font-mono font-medium min-w-[52px] text-right ${
                  item.trend === "up" ? "text-signal-verified" : "text-destructive"
                }`}>
                  {item.change}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Latest News */}
      <div className="flex-1 min-h-0">
        <div className="px-4 py-3 border-b border-border flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary" />
          <span className="text-[11px] font-semibold text-foreground tracking-tight">Latest News</span>
        </div>
        <div>
          {LATEST_NEWS.map((item, i) => (
            <div
              key={i}
              className="px-4 py-3 border-b border-border hover:bg-accent/20 transition-colors duration-200 cursor-pointer"
            >
              <p className="text-[11px] text-foreground font-medium leading-snug mb-1">{item.headline}</p>
              <span className="text-[9px] font-mono text-muted-foreground/50">{item.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Need help */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-border">
        <p className="text-[11px] font-medium text-foreground mb-0.5">Need help?</p>
        <a
          href="/docs"
          className="text-[11px] text-primary font-medium inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
        >
          Chat with support
          <ArrowRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
