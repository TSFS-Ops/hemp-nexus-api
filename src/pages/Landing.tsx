import { useState, useCallback, useEffect } from "react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { AnimatedBackground } from "@/components/landing/AnimatedBackground";
import { TradeInterestForm, type TradeInterestData } from "@/components/landing/TradeInterestForm";
import { SearchOutcomes, type LiquidityData } from "@/components/landing/SearchOutcomes";
import { WorkflowPipeline } from "@/components/landing/WorkflowPipeline";
import { TrustBadges } from "@/components/landing/TrustBadges";
import { savePreAuthState, consumePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { apiFetchPublic } from "@/lib/api-client";

export default function Landing() {
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [liquidityData, setLiquidityData] = useState<LiquidityData | null>(null);
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

  const handleSearch = useCallback(async (data: TradeInterestData) => {
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

    // Save pre-auth state
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

    // Show searching state and call real liquidity check
    setIsFormLocked(true);
    setIsSearching(true);
    setHasSearched(true);
    setLiquidityData(null);

    try {
      const { data: result, error } = await supabase.functions.invoke("liquidity-check", {
        body: {
          product: data.product,
          location: data.location || undefined,
        },
      });

      if (error) {
        console.error("Liquidity check failed:", error);
        // On error, show a graceful fallback — don't fake results
        setLiquidityData({
          partner_count: 0,
          region_count: 0,
          active_orders: 0,
          location_matches: 0,
          has_liquidity: false,
        });
      } else {
        setLiquidityData(result as LiquidityData);
      }
    } catch (err) {
      console.error("Liquidity check error:", err);
      setLiquidityData({
        partner_count: 0,
        region_count: 0,
        active_orders: 0,
        location_matches: 0,
        has_liquidity: false,
      });
    } finally {
      setIsSearching(false);
      setIsFormLocked(false);
    }
  }, [isAuthenticated]);

  return (
    <div className="landing-terminal h-screen-safe flex flex-col relative overflow-hidden" style={{ backgroundColor: 'var(--lt-bg)' }}>
      <AnimatedBackground />
      <PublicHeader />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto relative z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-6 sm:py-10 max-w-[860px] mx-auto">
          {/* Trust badges — above the fold, before any effort is asked */}
          <div className="mb-5">
            <TrustBadges />
          </div>

          {/* Hero headline */}
          <h1
            className="tracking-tighter max-w-none mb-2 leading-[1.08] text-[1.1rem] sm:text-[1.4rem] lg:text-[1.75rem] font-semibold"
            style={{ color: 'var(--lt-text)' }}
          >
            Discover Trading Partners. Validate Intent. Execute with Confidence.
          </h1>
          <p className="text-[13px] font-medium leading-relaxed mb-6 max-w-xl" style={{ color: 'var(--lt-text-muted)' }}>
            Izenzo is a pre-execution governance platform that structures trading partners, validates readiness, and improves execution certainty across trade, infrastructure, and institutional systems. It ensures transactions move through a sequenced, auditable process with defined parties and verified authority.
          </p>

          {/* Trade interest form */}
          <div
            className="mb-6 rounded-2xl overflow-hidden"
            style={{
              backgroundColor: '#131823',
              border: '1px solid var(--lt-border)',
            }}
          >
            <TradeInterestForm onSearch={handleSearch} isSearching={isSearching} isLocked={isFormLocked} />
            <SearchOutcomes
              isSearching={isSearching}
              hasSearched={hasSearched}
              liquidityData={liquidityData}
              onSignIn={navigateToAuth}
            />
          </div>

          {/* 6-step workflow pipeline — fully visible on mobile */}
          <div className="mb-6">
            <WorkflowPipeline />
          </div>

          {/* Closing CTA — catch users who scroll past everything */}
          <div
            className="mb-8 rounded-xl p-5 text-center"
            style={{
              backgroundColor: '#131823',
              border: '1px solid var(--lt-border)',
            }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--lt-text)' }}>
              Ready to find your trading partner?
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--lt-text-muted)' }}>
              Join verified buyers and sellers on a governance-first platform.
            </p>
            <button
              onClick={isAuthenticated ? () => window.location.assign("/dashboard/search") : navigateToAuth}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md text-sm font-medium transition-colors"
              style={{
                backgroundColor: 'var(--lt-emerald-dark)',
                color: '#fff',
              }}
            >
              {isAuthenticated ? "Go to console" : "Sign up free"}
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
