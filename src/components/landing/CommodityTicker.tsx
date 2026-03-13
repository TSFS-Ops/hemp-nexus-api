/**
 * Edge-to-edge live markets ticker — bottom of dashboard.
 */

const TICKER_DATA = [
  { asset: "Gold", price: "1,945.20", change: "0.62%", trend: "up" as const },
  { asset: "Crude Oil", price: "81.23", change: "0.41%", trend: "down" as const },
  { asset: "Carbon Credits", price: "73.15", change: "1.21%", trend: "up" as const },
  { asset: "USD/ZAR", price: "18.72", change: "0.34%", trend: "down" as const },
  { asset: "Copper", price: "8,923", change: "0.10%", trend: "up" as const },
];

export function CommodityTicker() {
  return (
    <div className="border-t border-border bg-background select-none overflow-hidden">
      <div className="flex items-center h-8">
        {/* Live Markets label */}
        <div className="flex-shrink-0 px-3 border-r border-border h-full flex items-center">
          <span className="text-[10px] font-mono font-medium text-primary uppercase tracking-widest">
            Live Markets
          </span>
        </div>
        {/* Scrolling ticker */}
        <div className="flex-1 overflow-hidden">
          <div className="flex items-center animate-ticker gap-0">
            {[...TICKER_DATA, ...TICKER_DATA].map((item, i) => (
              <div
                key={i}
                className="flex-shrink-0 flex items-center gap-2 px-4 border-r border-border h-8"
              >
                <span className="text-[10px] font-semibold text-foreground">{item.asset}</span>
                <span className="text-[10px] font-mono font-medium text-foreground">{item.price}</span>
                <span className={`text-[10px] font-mono ${
                  item.trend === "up" ? "text-signal-verified" : "text-destructive"
                }`}>
                  {item.trend === "up" ? "▲" : "▼"} {item.change}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
