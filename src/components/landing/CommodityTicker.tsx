/**
 * Edge-to-edge market signal ticker — Bloomberg-style horizontal strip.
 * Non-clickable. Indicative signals only. No sparklines.
 * Shows: Asset, Signal type, Quantity, Corridor, Status.
 */

const TICKER_DATA = [
  { asset: "Soybeans", signal: "Buyer interest", qty: "5,000 MT", corridor: "Brazil → East Africa", status: "Active" },
  { asset: "Carbon Credits", signal: "Seller signal", qty: "12,000 VCUs", corridor: "Kenya", status: "Pending" },
  { asset: "CDRs", signal: "Buyer intent", qty: "8,000 tCO₂", corridor: "Global", status: "Active" },
  { asset: "Copper", signal: "Seller signal", qty: "2,500 MT", corridor: "Zambia → China", status: "Verified" },
  { asset: "Lithium", signal: "Buyer interest", qty: "500 MT LCE", corridor: "DRC → Europe", status: "Active" },
  { asset: "Nickel", signal: "Seller signal", qty: "1,200 MT", corridor: "Indonesia", status: "Pending" },
  { asset: "Manganese", signal: "Buyer intent", qty: "3,000 MT", corridor: "SA → India", status: "Active" },
  { asset: "Cobalt", signal: "Seller signal", qty: "800 MT", corridor: "DRC → Japan", status: "Verified" },
];

export function CommodityTicker() {
  return (
    <div
      id="signals"
      className="border-t border-b border-border bg-card/60 overflow-hidden select-none"
    >
      <div className="flex items-center h-9 animate-ticker">
        <div className="flex items-center gap-10 px-4 whitespace-nowrap">
          {[...TICKER_DATA, ...TICKER_DATA].map((item, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-[11px]">
              <span className="font-semibold text-foreground">{item.asset}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground">{item.signal}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-foreground/70">{item.qty}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground/70">{item.corridor}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="font-mono text-primary/80 text-[10px]">{item.status}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
