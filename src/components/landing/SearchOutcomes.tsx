/**
 * Landing page search outcomes.
 * Shows REAL market data from the liquidity-check endpoint.
 * Honest display: if no results, says so clearly.
 */

import { LogIn, TrendingUp, Users, Globe, SearchX } from "lucide-react";
export interface LiquidityData {
  partner_count: string | number;
  region_count: number;
  active_orders: string | number;
  location_matches: string | number;
  has_liquidity: boolean;
}
interface SearchOutcomesProps {
  isSearching: boolean;
  hasSearched: boolean;
  liquidityData: LiquidityData | null;
  onSignIn: () => void;
}
export function SearchOutcomes({
  isSearching,
  hasSearched,
  liquidityData,
  onSignIn
}: SearchOutcomesProps) {
  if (!hasSearched) return null;
  if (isSearching) {
    return <div style={{
      borderTop: '1px solid var(--lt-border)'
    }}>
        <div className="px-3 py-2.5" style={{
        backgroundColor: 'var(--lt-panel)'
      }}>
          <span className="text-[11px] font-mono uppercase tracking-wider animate-pulse" style={{
          color: 'var(--lt-emerald)'
        }}>
            Checking liquidity...
          </span>
        </div>
        {[1, 2, 3].map(i => <div key={i} className="h-12" style={{
        borderBottom: '1px solid var(--lt-border)',
        background: `linear-gradient(90deg, var(--lt-panel) 0%, var(--lt-surface) 50%, var(--lt-panel) 100%)`,
        backgroundSize: '200% 100%',
        animation: `shimmer 1.5s ease-in-out infinite ${i * 100}ms`
      }} />)}
      </div>;
  }

  // No data yet (error or still loading)
  if (!liquidityData) return null;

  // No liquidity found — honest "no results" state
  if (!liquidityData.has_liquidity) {
    return <div className="animate-fade-up" style={{
      borderTop: '1px solid var(--lt-border)'
    }}>
        <div className="p-4 sm:p-5">
          <div className="flex items-center gap-2 mb-2">
            <SearchX className="h-4 w-4 flex-shrink-0" style={{
            color: 'var(--lt-text-muted)'
          }} />
            <h3 className="text-[15px] font-semibold tracking-tight leading-tight" style={{
            color: 'var(--lt-text)'
          }}>
              No active partners yet
            </h3>
          </div>
          <p className="text-[12px] font-medium leading-relaxed mb-4 max-w-md" style={{
          color: 'var(--lt-text-muted)'
        }}> We don't have verified partners for this product right now. Create a free account to register your trade interest: you'll be notified when a match becomes available. </p>
          <button onClick={onSignIn} className="w-full h-11 font-mono text-[12px] uppercase tracking-wider font-semibold
                     transition-all hover:opacity-90 active:scale-[0.998]
                     flex items-center justify-center gap-2.5 rounded-md" style={{
          backgroundColor: 'var(--lt-panel)',
          color: 'var(--lt-text)',
          border: '1px solid var(--lt-border)'
        }}>
            <LogIn className="h-3.5 w-3.5" />
            Register Trade Interest
          </button>
          <p className="text-[11px] font-mono mt-2.5 text-center tracking-wide" style={{
          color: 'var(--lt-text-dim)'
        }}>
            Free account. You'll be first to know when partners appear.
          </p>
        </div>
      </div>;
  }

  // Real liquidity found — show actual numbers
  return <div className="animate-fade-up" style={{
    borderTop: '1px solid var(--lt-border)'
  }}>
      <div className="px-4 py-3 grid grid-cols-3 gap-3" style={{
      backgroundColor: 'rgba(16, 185, 129, 0.04)'
    }}>
        <div className="flex items-center gap-2">
          <Users className="h-3.5 w-3.5 flex-shrink-0" style={{
          color: 'var(--lt-emerald)'
        }} />
          <span className="text-[11px] font-mono font-medium" style={{
          color: 'var(--lt-text-muted)'
        }}>
            {liquidityData.partner_count} partners
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 flex-shrink-0" style={{
          color: 'var(--lt-emerald)'
        }} />
          <span className="text-[11px] font-mono font-medium" style={{
          color: 'var(--lt-text-muted)'
        }}>
            {liquidityData.region_count} region{liquidityData.region_count !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 flex-shrink-0" style={{
          color: 'var(--lt-emerald)'
        }} />
          <span className="text-[11px] font-mono font-medium" style={{
          color: 'var(--lt-text-muted)'
        }}>
            {liquidityData.active_orders} open orders
          </span>
        </div>
      </div>

      <div className="p-4 sm:p-5">
        <h3 className="text-[15px] font-semibold tracking-tight leading-tight mb-2" style={{
        color: 'var(--lt-text)'
      }}>
          Trading partners available
        </h3>
        <p className="text-[12px] font-medium leading-relaxed mb-4 max-w-md" style={{
        color: 'var(--lt-text-muted)'
      }}>
          We've found verified partners matching your trade interest. Create a free account to view them and begin the deal process.
        </p>

        <button onClick={onSignIn} className="w-full h-11 font-mono text-[12px] uppercase tracking-wider font-semibold
                   transition-all hover:opacity-90 active:scale-[0.998]
                   flex items-center justify-center gap-2.5 rounded-md" style={{
        backgroundColor: 'var(--lt-emerald-dark)',
        color: 'white'
      }}>
          <LogIn className="h-3.5 w-3.5" />
          View Trading Partners
        </button>
        <p className="text-[11px] font-mono mt-2.5 text-center tracking-wide" style={{
        color: 'var(--lt-text-dim)'
      }}>
          Free account. No obligation. Results preserved after sign-up.
        </p>
      </div>
    </div>;
}