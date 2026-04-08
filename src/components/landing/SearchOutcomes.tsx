/**
 * Landing page search outcomes.
 * Unauthenticated users see a prompt to sign in with institutional copy.
 */

import { LogIn } from "lucide-react";

interface SearchOutcomesProps {
  isSearching: boolean;
  hasSearched: boolean;
  onSignIn: () => void;
}

export function SearchOutcomes({
  isSearching, hasSearched, onSignIn,
}: SearchOutcomesProps) {
  if (!hasSearched) return null;

  if (isSearching) {
    return (
      <div style={{ borderTop: '1px solid var(--lt-border)' }}>
        <div className="px-3 py-2.5" style={{ backgroundColor: 'var(--lt-panel)' }}>
          <span className="text-[11px] font-mono uppercase tracking-wider animate-pulse" style={{ color: 'var(--lt-emerald)' }}>
            Checking liquidity...
          </span>
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12"
            style={{
              borderBottom: '1px solid var(--lt-border)',
              background: `linear-gradient(90deg, var(--lt-panel) 0%, var(--lt-surface) 50%, var(--lt-panel) 100%)`,
              backgroundSize: '200% 100%',
              animation: `shimmer 1.5s ease-in-out infinite ${i * 100}ms`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="animate-fade-up" style={{ borderTop: '1px solid var(--lt-border)' }}>
      <div className="p-4 sm:p-5">
        <h3 className="text-[15px] font-semibold tracking-tight leading-tight mb-2" style={{ color: 'var(--lt-text)' }}>
          Sign in to view results
        </h3>
        <p className="text-[12px] font-medium leading-relaxed mb-5 max-w-md" style={{ color: 'var(--lt-text-muted)' }}>
          Counterparty search results are available to registered users.
          Create a free account to find verified trading partners and submit trade requests.
        </p>

        <button
          onClick={onSignIn}
          className="w-full h-11 font-mono text-[12px] uppercase tracking-wider font-semibold
                   transition-all hover:opacity-90 active:scale-[0.998]
                   flex items-center justify-center gap-2.5 rounded-md"
          style={{ backgroundColor: 'var(--lt-emerald-dark)', color: 'white' }}
        >
          <LogIn className="h-3.5 w-3.5" />
          Create Account to Search
        </button>
        <p className="text-[11px] font-mono mt-2.5 text-center tracking-wide" style={{ color: 'var(--lt-text-dim)' }}>
          No obligation. Free to create an account.
        </p>
      </div>
    </div>
  );
}
