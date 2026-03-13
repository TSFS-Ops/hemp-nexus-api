import { useState, useCallback } from "react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { AnimatedBackground } from "@/components/landing/AnimatedBackground";
import { BidOfferForm, type BidOfferData } from "@/components/landing/BidOfferForm";
import { SearchOutcomes } from "@/components/landing/SearchOutcomes";
import { MarketWatchSidebar } from "@/components/landing/MarketWatchSidebar";
import { WorkflowPipeline } from "@/components/landing/WorkflowPipeline";
import { PoiCommitmentRow } from "@/components/landing/PoiCommitmentRow";
import { TrustBadges } from "@/components/landing/TrustBadges";
import { CommodityTicker } from "@/components/landing/CommodityTicker";
import { savePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";

const SCAN_DURATION_MS = 1200;

export default function Landing() {
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [isFormLocked, setIsFormLocked] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();

  const navigateToAuth = useCallback(() => {
    if (isPreview) {
      window.location.assign("/auth?returnTo=/");
    } else {
      window.location.href = authUrl;
    }
  }, [isPreview, authUrl]);

  const handleSearch = useCallback(async (data: BidOfferData) => {
    const queryString = [data.product, data.location].filter(Boolean).join(" ");
    setLastQuery(queryString);

    if (isAuthenticated) {
      const params = new URLSearchParams({ q: queryString });
      window.location.assign(`/dashboard/search?${params.toString()}`);
      return;
    }

    setIsSearching(true);
    setIsFormLocked(true);
    setHasSearched(true);
    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS));
    setIsSearching(false);
    setIsFormLocked(false);
  }, [isAuthenticated]);

  return (
    <div className="h-screen h-[100dvh] flex flex-col bg-background relative overflow-hidden">
      <AnimatedBackground />
      <PublicHeader />

      {/* Main content */}
      <div className="flex-1 flex min-h-0 relative z-10">
        {/* Left: Main content area */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[960px]">
            {/* Hero headline — LOCKED: Do not change without client approval */}
            <h1 className="text-foreground tracking-tighter text-balance max-w-3xl mb-2 leading-[1.02]">
              Discover counterparties. Signal intent. Execute with confidence.
            </h1>
            <p className="text-[14px] text-muted-foreground mb-6">
              Governance Infrastructure for Trade and Institutions
            </p>

            {/* Search form with BID/OFFER tabs */}
            <div className="border border-border mb-4">
              <BidOfferForm onSearch={handleSearch} isSearching={isSearching} isLocked={isFormLocked} />
              <SearchOutcomes
                isSearching={isSearching}
                hasSearched={hasSearched}
                onSignIn={navigateToAuth}
              />
            </div>

            {/* 6-step workflow pipeline */}
            <div className="mb-4">
              <WorkflowPipeline />
            </div>

            {/* POI commitment row */}
            <div className="mb-4">
              <PoiCommitmentRow />
            </div>

            {/* Trust badges */}
            <TrustBadges />
          </div>
        </div>

        {/* Right: Market Watch sidebar — hidden on mobile */}
        <div className="hidden lg:block w-[300px] xl:w-[320px] flex-shrink-0">
          <MarketWatchSidebar />
        </div>
      </div>

      {/* Bottom: Live Markets ticker */}
      <CommodityTicker />
    </div>
  );
}
