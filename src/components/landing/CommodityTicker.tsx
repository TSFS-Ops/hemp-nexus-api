/**
 * Bloomberg-style commodity ticker strip.
 * Illustrative/indicative data — not live exchange prices.
 * Phase 1: non-clickable, no sparklines, no live polling.
 */

const TICKER_DATA = [
  { asset: "Soybeans", signal: "Buyer interest", qty: "5,000 MT", corridor: "Brazil → East Africa" },
  { asset: "Carbon Credits", signal: "Seller signal", qty: "12,000 VCUs", corridor: "Kenya" },
  { asset: "CDRs", signal: "Buyer intent", qty: "8,000 tCO₂", corridor: "Global" },
  { asset: "Copper", signal: "Seller signal", qty: "2,500 MT", corridor: "Zambia → China" },
  { asset: "Lithium", signal: "Buyer interest", qty: "500 MT LCE", corridor: "DRC → Europe" },
  { asset: "Nickel", signal: "Seller signal", qty: "1,200 MT", corridor: "Indonesia" },
  { asset: "Manganese", signal: "Buyer intent", qty: "3,000 MT", corridor: "South Africa → India" },
  { asset: "Cobalt", signal: "Seller signal", qty: "800 MT", corridor: "DRC → Japan" },
];

export function CommodityTicker() {
  return (
    <div className="border-t border-b border-border bg-card/80 overflow-hidden">
      <div className="flex items-center h-10 animate-ticker">
        <div className="flex items-center gap-8 px-4 whitespace-nowrap">
          {[...TICKER_DATA, ...TICKER_DATA].map((item, i) => (
            <span key={i} className="inline-flex items-center gap-2 text-xs">
              <span className="font-semibold text-foreground">{item.asset}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{item.signal}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-foreground/80">{item.qty}</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">{item.corridor}</span>
              {i < TICKER_DATA.length * 2 - 1 && (
                <span className="ml-4 text-border">│</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
