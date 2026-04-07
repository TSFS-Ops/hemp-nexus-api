import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { AnimatedBackground } from "@/components/landing/AnimatedBackground";
import { BidOfferForm, type BidOfferData } from "@/components/landing/BidOfferForm";
import { SearchOutcomes } from "@/components/landing/SearchOutcomes";
import { MarketWatchSidebar } from "@/components/landing/MarketWatchSidebar";
import { WorkflowPipeline } from "@/components/landing/WorkflowPipeline";

import { TrustBadges } from "@/components/landing/TrustBadges";
import { CommodityTicker } from "@/components/landing/CommodityTicker";
import { savePreAuthState, consumePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";

const SCAN_DURATION_MS = 1200;
const SCAN_TIMEOUT_MS = 8000;

export default function Landing() {
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [lastFormData, setLastFormData] = useState<BidOfferData | null>(null);
  const [isFormLocked, setIsFormLocked] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("resume") !== "1") return;
    if (!isAuthenticated) return;

    const preAuth = consumePreAuthState();
    if (preAuth?.query) {
      const searchParams = new URLSearchParams({ q: preAuth.query, resume: "1" });
      window.location.assign(`/dashboard/search?${searchParams.toString()}`);
    } else {
      window.location.assign("/dashboard");
    }
  }, [authLoading, isAuthenticated]);

  const navigateToAuth = useCallback(() => {
    if (lastQuery) {
      savePreAuthState({
        query: lastQuery,
        selectedIds: [],
        pendingAction: "interested",
        returnTo: "/",
      });
    }
    if (isPreview) {
      window.location.assign("/auth?returnTo=/");
    } else {
      window.location.href = authUrl;
    }
  }, [isPreview, authUrl, lastQuery]);

  const handleSearch = useCallback(async (data: BidOfferData) => {
    const queryString = [data.product, data.location].filter(Boolean).join(" ");
    setLastQuery(queryString);
    setLastFormData(data);

    // Build structured URL params so the dashboard search can use price/volume/side
    const buildSearchParams = () => {
      const p = new URLSearchParams({ q: queryString });
      if (data.side) p.set("side", data.side);
      if (data.price) p.set("price", data.price);
      if (data.volume) p.set("volume", data.volume);
      if (data.location) p.set("location", data.location);
      return p;
    };

    if (isAuthenticated) {
      window.location.assign(`/dashboard/search?${buildSearchParams().toString()}`);
      return;
    }

    savePreAuthState({
      query: queryString,
      selectedIds: [],
      pendingAction: "interested",
      returnTo: "/",
      side: data.side,
      price: data.price,
      volume: data.volume,
      location: data.location,
    });

    setIsSearching(true);
    setIsFormLocked(true);
    setHasSearched(true);
    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS));
    setIsSearching(false);
    setIsFormLocked(false);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isSearching) return;
    const timeout = setTimeout(() => {
      setIsSearching(false);
      setIsFormLocked(false);
    }, SCAN_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [isSearching]);

  return (
    <div className="landing-terminal h-screen-safe flex flex-col relative overflow-hidden" style={{ backgroundColor: 'var(--lt-bg)' }}>
      <AnimatedBackground />
      <PublicHeader />

      {/* Main content */}
      <div className="flex-1 flex min-h-0 relative z-10">
        {/* Left: Main content area — 70% */}
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-[960px]">
            {/* Page header — reduced from billboard to header */}
            <h1
              className="tracking-tighter max-w-none mb-1 leading-[1.08] text-[1rem] sm:text-[1.25rem] lg:text-[1.5rem] font-semibold whitespace-normal lg:whitespace-nowrap"
              style={{ color: 'var(--lt-text)' }}
            >
              Discover counterparties. Signal intent. Execute with confidence.
            </h1>


            {/* Search form — interactive teaser */}
            <div
              className="mb-5 rounded-2xl overflow-hidden"
              style={{
                backgroundColor: '#131823',
                border: '1px solid var(--lt-border)',
              }}
            >
              <BidOfferForm onSearch={handleSearch} isSearching={isSearching} isLocked={isFormLocked} />
              <SearchOutcomes
                isSearching={isSearching}
                hasSearched={hasSearched}
                onSignIn={navigateToAuth}
              />
            </div>

            {/* 6-step workflow pipeline */}
            <div className="mb-5">
              <WorkflowPipeline />
            </div>

            {/* Single CTA — replaces POI toggle + Proceed with WaD */}
            <div className="mb-8">
              <button
                onClick={() => {
                  if (isAuthenticated) {
                    window.location.assign("/dashboard");
                  } else {
                    navigateToAuth();
                  }
                }}
                className="w-full sm:w-auto px-8 h-11 font-mono text-[11px] uppercase tracking-wider font-semibold
                         transition-all active:scale-[0.98] rounded-full flex items-center justify-center gap-2"
                style={{
                  backgroundColor: 'var(--lt-emerald-dark)',
                  color: 'white',
                  boxShadow: '0 0 24px rgba(5, 150, 105, 0.3)',
                }}
              >
                {isAuthenticated ? 'Go to Dashboard' : 'Create Account to Execute Trade'}
                <span className="text-[13px]">→</span>
              </button>
            </div>

            {/* Trust badges — below the fold */}
            <TrustBadges />
          </div>
        </div>

        {/* Right: Bloomberg sidebar — hidden on mobile */}
        <div className="hidden lg:block w-[300px] xl:w-[320px] flex-shrink-0">
          <MarketWatchSidebar />
        </div>
      </div>

      {/* Bottom: Live Markets ticker */}
      <CommodityTicker />
    </div>
  );
}
