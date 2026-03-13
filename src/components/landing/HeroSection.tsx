/**
 * Hero section — Simple explanation-first layout.
 * "Cell phone cover" design: masks technical complexity.
 * Three clear steps linked to real product flows.
 */

import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { useAuth } from "@/contexts/AuthContext";
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
      {/* Soft background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
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
        {/* Explanation — simple, non-technical */}
        <div className="mb-10 sm:mb-14 animate-fade-up">
          <h1 className="text-foreground tracking-tighter text-balance max-w-2xl mb-5 leading-[1.05]">
            Find the right counterparty. Signal your intent. Get to trade.
          </h1>
          <p className="text-[14px] text-muted-foreground max-w-lg leading-relaxed mb-8 animate-fade-up delay-75">
            Izenzo connects buyers and sellers across commodities and jurisdictions.
            Enter what you're looking for, find a match, and move toward a verified agreement — all in one place.
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
                  Create Account
                  <ArrowRight className="h-3 w-3" />
                </a>
                <a
                  href="#search"
                  className="inline-flex items-center gap-2 px-6 h-11 border border-border bg-background
                           font-mono text-[11px] uppercase tracking-widest font-medium text-foreground
                           hover:bg-accent hover:border-foreground/15 transition-all active:scale-[0.98]"
                >
                  Try a Search
                </a>
              </>
            )}
          </div>
        </div>

        {/* Search form — below explanation */}
        <div id="search" className="border border-border animate-fade-up delay-200">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-signal-verified" />
            <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              Enter your bid or offer details
            </span>
          </div>
          <BidOfferForm onSearch={onSearch} isSearching={isSearching} isLocked={isFormLocked} />
          <SearchOutcomes
            isSearching={isSearching}
            hasSearched={hasSearched}
            onSignIn={onSignIn}
          />
        </div>
      </div>
    </section>
  );
}
