/**
 * Continuous scrolling ticker tape — Bloomberg-style live markets bar.
 * CSS marquee animation, monospace prices, red/green indicators.
 */

import { ChevronUp, ChevronDown } from "lucide-react";

const TICKER_DATA = [
  { name: "Gold", price: "1,945.20", change: "+0.62%", positive: true },
  { name: "Crude Oil", price: "81.23", change: "-0.41%", positive: false },
  { name: "Carbon Credits", price: "73.15", change: "+1.21%", positive: true },
  { name: "USD/ZAR", price: "18.72", change: "-0.34%", positive: false },
  { name: "Copper", price: "8,923", change: "+0.10%", positive: true },
];

function TickerItem({ item }: { item: typeof TICKER_DATA[0] }) {
  return (
    <div className="flex items-center gap-2 px-5 flex-shrink-0">
      <span className="text-[11px] font-semibold" style={{ color: 'var(--lt-text)' }}>{item.name}</span>
      <span className="text-[11px] font-mono font-semibold tabular-nums" style={{ color: 'var(--lt-text)' }}>{item.price}</span>
      <span
        className="text-[11px] font-mono font-semibold flex items-center gap-0.5"
        style={{ color: item.positive ? 'var(--lt-emerald)' : 'var(--lt-red)' }}
      >
        {item.positive ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        {item.change}
      </span>
    </div>
  );
}

export function CommodityTicker() {
  return (
    <div
      className="relative overflow-hidden select-none"
      style={{
        backgroundColor: 'var(--lt-bg)',
        borderTop: '1px solid var(--lt-border)',
        height: '32px',
      }}
    >
      {/* Live Markets label */}
      <div
        className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-3"
        style={{ backgroundColor: 'var(--lt-bg)', borderRight: '1px solid var(--lt-border)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--lt-emerald)' }} />
          <span className="text-[10px] font-mono font-semibold uppercase tracking-wider" style={{ color: 'var(--lt-emerald)' }}>
            Markets (Illustrative)
          </span>
        </div>
      </div>

      {/* Scrolling ticker — doubled for seamless loop */}
      <div className="flex items-center h-full animate-marquee" style={{ paddingLeft: '140px' }}>
        {/* First set */}
        {TICKER_DATA.map((item) => (
          <TickerItem key={`a-${item.name}`} item={item} />
        ))}
        {/* Duplicate for seamless scroll */}
        {TICKER_DATA.map((item) => (
          <TickerItem key={`b-${item.name}`} item={item} />
        ))}
        {/* Triple for wider screens */}
        {TICKER_DATA.map((item) => (
          <TickerItem key={`c-${item.name}`} item={item} />
        ))}
        {TICKER_DATA.map((item) => (
          <TickerItem key={`d-${item.name}`} item={item} />
        ))}
      </div>
    </div>
  );
}
