/**
 * Hero section — Explanation-first layout.
 * Headline + explanation + CTAs appear first, search form below.
 * Right-hand panel shows market activity alongside governance.
 */

import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";
import { GovernancePanel } from "./GovernancePanel";
import { MarketSignalsPanel } from "./MarketSignalsPanel";
import { BidOfferForm, type BidOfferData } from "./BidOfferForm";
import { SearchOutcomes } from "./SearchOutcomes";

interface HeroSectionProps {
  isSearching: boolean;
  isFormLocked: boolean;
  hasSearched: boolean;
  onSearch: (data: BidOfferData) => void;
  onConfirmIntent: () => void;
  onPublishPoi: () => void;
  onSignIn: () => void;
}

export function HeroSection({
  isSearching, isFormLocked, hasSearched,
  onSearch, onConfirmIntent, onPublishPoi, onSignIn,
}: HeroSectionProps) {
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();

  return (
    <section className="relative pt-16 sm:pt-20 lg:pt-28 pb-8 sm:pb-12 px-4 sm:px-6 overflow-hidden">
      {/* Architectural grid background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          className="absolute inset-0 opacity-[0.035] dark:opacity-[0.06]"
          style={{
            backgroundImage: `radial-gradient(circle, hsl(var(--foreground)) 0.5px, transparent 0.5px)`,
            backgroundSize: "24px 24px",
          }}
        />
        <div
          className="absolute -top-1/3 -left-1/4 w-[80%] h-[80%] rounded-full blur-[120px] opacity-[0.06]"
          style={{ background: `hsl(var(--primary))` }}
        />
        <div
          className="absolute -bottom-1/4 -right-1/4 w-[60%] h-[60%] rounded-full blur-[100px] opacity-[0.03]"
          style={{ background: `hsl(var(--earth-slate))` }}
        />
      </div>

      <div className="max-w-[1280px] mx-auto relative z-10">
        {/* Panel A: Explanation — headline, description, CTAs */}
        <div className="mb-10 sm:mb-14 animate-fade-up">
          <p className="text-[11px] font-mono uppercase tracking-widest text-primary mb-6">
            Closing the $2.5 trillion global trade-finance gap
          </p>
          <h1 className="text-foreground tracking-tighter text-balance max-w-3xl mb-5 leading-[1.02]">
            Discover counterparties. Signal intent. Execute with confidence.
          </h1>
          <p className="text-[13px] text-muted-foreground max-w-lg leading-relaxed mb-2 animate-fade-up delay-75">
            Izenzo is a next-generation search and governance infrastructure for trade.
          </p>
          <p className="text-[13px] text-muted-foreground max-w-lg leading-relaxed mb-8 animate-fade-up delay-100">
            It enables counterparties to discover each other, signal intent, and progress toward compliant transactions across industries and jurisdictions. By combining structured search with Proof-of-Intention (POI), it turns early-stage interest into governed, verifiable pathways to trade.
          </p>

          {/* CTA buttons */}
          <div className="flex flex-wrap items-center gap-3 animate-fade-up delay-150">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 px-6 h-11 bg-primary text-primary-foreground shadow-inner-metallic
                         font-mono text-[11px] uppercase tracking-widest font-medium hover:opacity-90 transition-all active:scale-[0.98]"
              >
                Go to Dashboard
                <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <>
                <a
                  href={isPreview ? "/auth" : authUrl}
                  className="inline-flex items-center gap-2 px-6 h-11 bg-primary text-primary-foreground shadow-inner-metallic
                           font-mono text-[11px] uppercase tracking-widest font-medium hover:opacity-90 transition-all active:scale-[0.98]"
                >
                  Start Now
                  <ArrowRight className="h-3 w-3" />
                </a>
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 px-6 h-11 border border-border bg-background
                           font-mono text-[11px] uppercase tracking-widest font-medium text-foreground
                           hover:bg-accent hover:border-foreground/15 transition-all active:scale-[0.98]"
                >
                  Read the Docs
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Panel B: Search + Side panels grid (below explanation) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:border lg:border-border animate-fade-up delay-200">
          {/* Left: Search */}
          <div className="lg:col-span-8 lg:border-r lg:border-border">
            <div className="px-4 py-3 border-b border-border lg:border-t-0 border-t flex items-center gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal-verified" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                Counterparty Search
              </span>
            </div>
            <BidOfferForm onSearch={onSearch} isSearching={isSearching} isLocked={isFormLocked} />
            <SearchOutcomes
              isSearching={isSearching}
              hasSearched={hasSearched}
              onSignIn={onSignIn}
            />
          </div>

          {/* Right: Market Signals + Governance */}
          <aside className="lg:col-span-4 hidden lg:flex lg:flex-col">
            <MarketSignalsPanel />
            <GovernancePanel isScanning={isSearching} />
          </aside>
        </div>

        {/* Mobile: stacked panels */}
        <div className="mt-4 lg:hidden space-y-4">
          <MarketSignalsPanel />
          <GovernancePanel isScanning={isSearching} />
        </div>
      </div>
    </section>
  );
}
