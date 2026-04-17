import { useState, useCallback, useEffect } from "react";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { AnimatedBackground } from "@/components/landing/AnimatedBackground";
import { HeroStripeGlow } from "@/components/landing/HeroStripeGlow";
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
      const result = await apiFetchPublic<any>("liquidity-check", {
        method: "POST",
        body: JSON.stringify({
          product: data.product,
          location: data.location || undefined,
        }),
      });

      if (result) {
        setLiquidityData(result as LiquidityData);
      } else {
        setLiquidityData({
          partner_count: 0,
          region_count: 0,
          active_orders: 0,
          location_matches: 0,
          has_liquidity: false,
        });
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
    <div className="min-h-screen flex flex-col bg-white" style={{ fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <PublicHeader />
      <main className="flex-1">
        <HeroStripeGlow
          onGetStarted={isAuthenticated ? () => window.location.assign("/dashboard") : navigateToAuth}
          onContactSales={() => window.location.assign("mailto:sales@izenzo.co.za")}
        />
      </main>
    </div>
  );
}
