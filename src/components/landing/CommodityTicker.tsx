/**
 * Edge-to-edge market signal ticker — Swiss-Terminal trading cards.
 * Non-clickable. Indicative signals only. Monospace quantities.
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

function StatusLabel({ status }: { status: string }) {
  const color =
    status === "Verified"
      ? "text-signal-verified"
      : status === "Pending"
      ? "text-signal-pending"
      : "text-primary";

  return (
    <span className={`text-[9px] font-mono uppercase tracking-widest ${color}`}>
      {status}
    </span>
  );
}

export function CommodityTicker() {
  return (
    <div
      id="signals"
      className="border-t border-b border-border bg-background overflow-hidden select-none"
    >
      <div className="flex items-stretch animate-ticker">
        {[...TICKER_DATA, ...TICKER_DATA].map((item, i) => (
          <div
            key={i}
            className="flex-shrink-0 border-r border-border px-4 py-2.5 min-w-[200px]"
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[11px] font-semibold text-foreground">{item.asset}</span>
              <StatusLabel status={item.status} />
            </div>
            <div className="text-[10px] text-muted-foreground">{item.signal}</div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] font-mono text-foreground/70">{item.qty}</span>
              <span className="text-[9px] font-mono text-muted-foreground/50">{item.corridor}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
