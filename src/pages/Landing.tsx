import { useState, useCallback, useEffect } from "react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { AnimatedBackground } from "@/components/landing/AnimatedBackground";
import { BidOfferForm, type BidOfferData } from "@/components/landing/BidOfferForm";
import { SearchOutcomes } from "@/components/landing/SearchOutcomes";
import { WorkflowPipeline } from "@/components/landing/WorkflowPipeline";
import { TrustBadges } from "@/components/landing/TrustBadges";
import { savePreAuthState, consumePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";

const REDIRECT_DELAY_MS = 300;

export default function Landing() {
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
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

    setIsFormLocked(true);
    setHasSearched(true);
    await new Promise((r) => setTimeout(r, REDIRECT_DELAY_MS));
    setIsFormLocked(false);
  }, [isAuthenticated]);


  return (
    <div className="landing-terminal h-screen-safe flex flex-col relative overflow-hidden" style={{ backgroundColor: 'var(--lt-bg)' }}>
      <AnimatedBackground />
      <PublicHeader />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-10 max-w-[860px] mx-auto">
          {/* Hero headline */}
          <h1
            className="tracking-tighter max-w-none mb-2 leading-[1.08] text-[1.1rem] sm:text-[1.4rem] lg:text-[1.75rem] font-semibold"
            style={{ color: 'var(--lt-text)' }}
          >
            Global Trade, Governed. From Discovery to Signed Deal.
          </h1>
          <p className="text-[13px] font-medium leading-relaxed mb-6 max-w-lg" style={{ color: 'var(--lt-text-muted)' }}>
            Search for verified buyers and sellers, then progress toward compliant, signed transactions.
          </p>

          {/* Search form */}
          <div
            className="mb-6 rounded-2xl overflow-hidden"
            style={{
              backgroundColor: '#131823',
              border: '1px solid var(--lt-border)',
            }}
          >
            <BidOfferForm onSearch={handleSearch} isSearching={false} isLocked={isFormLocked} />
            <SearchOutcomes
              isSearching={false}
              hasSearched={hasSearched}
              onSignIn={navigateToAuth}
            />
          </div>

          {/* 6-step workflow pipeline */}
          <div className="mb-6">
            <WorkflowPipeline />
          </div>

          {/* Trust badges */}
          <TrustBadges />
        </div>
      </div>
    </div>
  );
}
