/**
 * Bloomberg-style right sidebar — Market Watch + Latest News + Support.
 * Distinct panel background, glowing emerald numbers, monospace prices.
 */

import { useState, useEffect } from "react";
import { ArrowRight, ChevronUp, ChevronDown } from "lucide-react";

const MARKET_DATA = [
  { name: "Gold", price: 1945.20, change: 0.62, positive: true },
  { name: "Oil (Brent)", price: 81.23, change: -0.41, positive: false },
  { name: "Carbon Credits", price: 73.15, change: 1.21, positive: true },
  { name: "USD/ZAR", price: 18.72, change: -0.34, positive: false },
  { name: "Copper", price: 8923.11, change: 0.10, positive: true },
];

const NEWS_ITEMS = [
  { headline: "New compliance rule approved", time: "5 min ago" },
  { headline: "Infrastructure deal signed", time: "18 min ago" },
  { headline: "Carbon market hits record volume", time: "35 min ago" },
  { headline: "Regulators align on data standards", time: "1 hour ago" },
];

export function MarketWatchSidebar() {
  const [prices] = useState(MARKET_DATA);

  return (
    <div
      className="flex flex-col h-full rounded-2xl mx-2 my-2"
      style={{
        backgroundColor: '#131823',
        border: '1px solid var(--lt-border)',
      }}
    >
      {/* Market Watch Header */}
      <div className="flex-shrink-0 px-4 py-3 flex items-center justify-between"
           style={{ borderBottom: '1px solid var(--lt-border)' }}>
        <div className="flex items-center gap-2">
           <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--lt-emerald)' }} />
          <span className="text-[12px] font-semibold tracking-tight" style={{ color: 'var(--lt-text)' }}>
            Market Watch (Illustrative)
          </span>
        </div>
        <ChevronUp className="h-3.5 w-3.5" style={{ color: 'var(--lt-text-dim)' }} />
      </div>

      {/* Price list */}
      <div className="flex-shrink-0">
        {prices.map((item, i) => (
          <div
            key={item.name}
            className="flex items-center justify-between px-4 py-2.5 transition-colors duration-200 hover:bg-white/[0.02]"
            style={{ borderBottom: '1px solid var(--lt-border)' }}
          >
            <span className="text-[12px] font-medium" style={{ color: 'var(--lt-text)' }}>{item.name}</span>
            <div className="flex items-center gap-3">
              <span
                className={`text-[13px] font-mono font-semibold tabular-nums ${tickIndex === i ? 'animate-tick' : ''}`}
                style={{ color: 'var(--lt-text)' }}
              >
                {item.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span
                className="text-[11px] font-mono font-semibold tabular-nums flex items-center gap-0.5"
                style={{
                  color: item.positive ? 'var(--lt-emerald-bright)' : 'var(--lt-red)',
                  textShadow: item.positive ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none',
                }}
              >
                {item.positive ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
                {item.positive ? '+' : ''}{item.change.toFixed(2)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Latest News */}
      <div className="flex-1 min-h-0">
        <div className="px-4 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--lt-border)' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--lt-emerald)' }} />
          <span className="text-[12px] font-semibold tracking-tight" style={{ color: 'var(--lt-text)' }}>
            Latest News
          </span>
          <ChevronUp className="h-3.5 w-3.5 ml-auto" style={{ color: 'var(--lt-text-dim)' }} />
        </div>
        <div>
          {NEWS_ITEMS.map((item, i) => (
            <div
              key={i}
              className="px-4 py-3 transition-colors duration-200 hover:bg-white/[0.02]"
              style={{ borderBottom: '1px solid var(--lt-border)' }}
            >
              <p className="text-[12px] font-medium leading-snug mb-1" style={{ color: 'var(--lt-text)' }}>{item.headline}</p>
              <span className="text-[10px] font-mono" style={{ color: 'var(--lt-text-dim)' }}>{item.time}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Support */}
      <div className="flex-shrink-0 px-4 py-3" style={{ borderTop: '1px solid var(--lt-border)' }}>
        <p className="text-[12px] font-medium mb-0.5" style={{ color: 'var(--lt-text)' }}>Need help?</p>
        <a
          href="mailto:support@izenzo.co.za"
          className="text-[12px] font-medium inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
          style={{ color: 'var(--lt-emerald)' }}
        >
          Chat with support
          <ArrowRight className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
