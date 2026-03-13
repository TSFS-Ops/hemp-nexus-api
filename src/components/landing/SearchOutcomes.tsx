/**
 * Landing page search outcomes — sign-in gated.
 * Unauthenticated users see a scanning animation then a prompt to sign in.
 * Authenticated users are redirected to the console search (handled by parent).
 */

import { ArrowRight, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import { useCrossDomainUrls } from "@/components/HostnameRouter";

interface SearchOutcomesProps {
  isSearching: boolean;
  hasSearched: boolean;
  onSignIn: () => void;
}

export function SearchOutcomes({
  isSearching, hasSearched, onSignIn,
}: SearchOutcomesProps) {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();

  if (!hasSearched) return null;

  // Scanning animation
  if (isSearching) {
    return (
      <div className="mt-0 border-t border-border">
        <div className="px-3 py-2.5 bg-basalt">
          <span className="text-[9px] font-mono uppercase tracking-widest text-basalt-foreground/60 animate-pulse">
            Scanning verified counterparty registry...
          </span>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 border-b border-border shimmer" style={{ animationDelay: `${i * 100}ms` }} />
        ))}
      </div>
    );
  }

  // Search complete — prompt sign-in to view results
  // Use onSignIn callback which handles pre-auth state saving and returnTo
  return (
    <div className="mt-0 border-t border-border animate-fade-up">
      <div className="p-4 sm:p-5">
        <h3 className="text-[15px] font-semibold text-foreground tracking-tighter leading-tight mb-2">
          Sign in to view results
        </h3>
        <p className="text-[12px] text-muted-foreground leading-relaxed mb-5 max-w-md">
          Counterparty search results are available to registered users.
          Create a free account to search verified counterparties, create matches, and confirm intent.
        </p>

        <button
          onClick={onSignIn}
          className="w-full h-11 bg-primary text-primary-foreground shadow-inner-metallic
                   font-mono text-[11px] uppercase tracking-widest font-medium
                   transition-all hover:opacity-90 active:scale-[0.998]
                   flex items-center justify-center gap-2.5"
        >
          <LogIn className="h-3.5 w-3.5" />
          Sign in to search
        </button>
        <p className="text-[10px] font-mono text-muted-foreground/40 mt-2.5 text-center tracking-wide">
          No obligation. Free to create an account.
        </p>
      </div>
    </div>
  );
}
