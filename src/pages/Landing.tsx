import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { DEMO_SEARCH_DELAY_MS } from "@/lib/constants";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { CommodityTicker } from "@/components/landing/CommodityTicker";
import { GovernancePanel } from "@/components/landing/GovernancePanel";
import { BidOfferForm, type BidOfferData } from "@/components/landing/BidOfferForm";
import { SearchOutcomes } from "@/components/landing/SearchOutcomes";
import { type DemoSearchResult, getDemoResultsForQuery } from "@/lib/demo-data";
import { savePreAuthState, consumePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";

export default function Landing() {
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DemoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();

  // Restore pre-auth state after sign-in
  useEffect(() => {
    if (!isAuthenticated) return;
    const restored = consumePreAuthState();
    if (!restored) return;
    setLastQuery(restored.query);
    setHasSearched(true);
    setResults(getDemoResultsForQuery(restored.query));
    setSelectedResults(new Set(restored.selectedIds));
    toast.success("Welcome back — your search has been restored.");
  }, [isAuthenticated]);

  useEffect(() => {
    if (searchParams.get("resume") === "1" && isAuthenticated) {
      const restored = consumePreAuthState();
      if (!restored) return;
      setLastQuery(restored.query);
      setHasSearched(true);
      setResults(getDemoResultsForQuery(restored.query));
      setSelectedResults(new Set(restored.selectedIds));
      toast.success("Welcome back — your search has been restored.");
    }
  }, [searchParams, isAuthenticated]);

  const handleSearch = async (data: BidOfferData) => {
    setIsSearching(true);
    setHasSearched(true);
    const queryString = [data.product, data.location].filter(Boolean).join(" ");
    setLastQuery(queryString);
    await new Promise((r) => setTimeout(r, DEMO_SEARCH_DELAY_MS));
    setResults(getDemoResultsForQuery(queryString));
    setIsSearching(false);
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedResults);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedResults(next);
  };

  const navigateToAuth = () => {
    if (isPreview) {
      window.location.assign("/auth?returnTo=/");
    } else {
      window.location.href = authUrl;
    }
  };

  const handleConfirmIntent = () => {
    if (isAuthenticated) {
      toast.success(`Interest confirmed for ${selectedResults.size} counterpart${selectedResults.size > 1 ? "ies" : "y"}.`);
      return;
    }
    savePreAuthState({
      query: lastQuery,
      selectedIds: Array.from(selectedResults),
      pendingAction: "interested",
      returnTo: "/",
    });
    toast.info("Sign in to continue", {
      description: "Create an account to confirm your interest and generate a verified POI.",
      action: { label: "Sign in", onClick: navigateToAuth },
    });
  };

  const handlePublishPoi = () => {
    if (isAuthenticated) {
      toast.success("Your intent has been published as a draft POI.");
      return;
    }
    savePreAuthState({
      query: lastQuery,
      selectedIds: [],
      pendingAction: "publish_poi",
      returnTo: "/",
    });
    toast.info("Sign in to publish intent", {
      description: "Create an account to generate a Proof-of-Intention and attract counterparties.",
      action: { label: "Create Account", onClick: navigateToAuth },
    });
  };

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background">
      {/* Panel 1: Navigation */}
      <PublicHeader />

      {/* Panel 2: Hero Command Center + Governance Panel */}
      <section className="pt-10 sm:pt-14 lg:pt-16 pb-8 sm:pb-10 px-4 sm:px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Left: Hero + Search */}
            <div className="lg:col-span-8">
              <h1 className="text-foreground mb-3 text-balance">
                Discover counterparties. Signal intent.{" "}
                <br className="hidden sm:inline" />
                Execute with confidence.
              </h1>
              <p className="text-[14px] font-medium text-foreground/80 mb-1.5">
                Izenzo API is a next-generation search and governance infrastructure for trade.
              </p>
              <p className="text-[13px] text-muted-foreground mb-8 max-w-xl leading-relaxed">
                It enables counterparties to discover each other, signal intent, and progress toward
                compliant transactions across industries and jurisdictions. By combining structured
                search with Proof-of-Intention (POI), it turns early-stage interest into governed,
                verifiable pathways to trade.
              </p>

              {/* Search form — terminal block */}
              <div className="border border-border rounded-sm p-4 sm:p-5 bg-card">
                <BidOfferForm onSearch={handleSearch} isSearching={isSearching} />
                <SearchOutcomes
                  results={results}
                  isSearching={isSearching}
                  hasSearched={hasSearched}
                  selectedResults={selectedResults}
                  onToggleSelect={toggleSelect}
                  onConfirmIntent={handleConfirmIntent}
                  onPublishPoi={handlePublishPoi}
                  onSignIn={navigateToAuth}
                />
              </div>
            </div>

            {/* Right: Governance Panel */}
            <aside className="lg:col-span-4 hidden lg:block">
              <GovernancePanel />
            </aside>
          </div>

          {/* Mobile governance strip */}
          <div className="mt-6 lg:hidden">
            <GovernancePanel />
          </div>
        </div>
      </section>

      {/* Panel 3: Market Signal Ticker */}
      <CommodityTicker />

      {/* Panel 4a: How It Works */}
      <section id="how-it-works" className="py-14 sm:py-16 px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1280px] mx-auto">
          <h2 className="text-foreground mb-8">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Search",
                desc: "Enter a bid or offer with product, volume, price, and location. The platform searches for verified counterparties across registered data sources.",
              },
              {
                step: "02",
                title: "Signal Intent",
                desc: "Select a counterparty or publish a Proof-of-Intention (POI) to attract interest. Your intent becomes a governed, verifiable signal — not a dead end.",
              },
              {
                step: "03",
                title: "Execute",
                desc: "Progress through eligibility, compliance workflows, and governance checkpoints toward a compliant transaction with tamper-evident proof at every step.",
              },
            ].map((item) => (
              <div key={item.step} className="space-y-2">
                <span className="text-[11px] font-mono font-medium text-primary tracking-wider">
                  {item.step}
                </span>
                <h3 className="text-foreground">{item.title}</h3>
                <p className="text-[13px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Panel 4b: Developer Access — Basalt dark terminal */}
      <section className="py-14 sm:py-16 px-4 sm:px-6 bg-basalt text-basalt-foreground">
        <div className="max-w-[1280px] mx-auto">
          <h2 className="text-basalt-foreground mb-2">Developer Access</h2>
          <p className="text-[13px] text-basalt-foreground/60 mb-6 max-w-lg leading-relaxed">
            Integrate counterparty discovery, intent signalling, and governance workflows
            directly into your systems via the Izenzo API.
          </p>
          <div className="border border-basalt-foreground/10 rounded-sm bg-basalt/80 p-5 font-mono text-[13px] leading-relaxed overflow-x-auto">
            <p className="text-basalt-foreground/40"># Search for counterparties</p>
            <p className="mt-1">
              <span className="text-primary">curl</span>
              <span className="text-basalt-foreground"> -X POST https://api.trade.izenzo.co.za/v1/search \</span>
            </p>
            <p className="pl-4 text-basalt-foreground">
              -H "Authorization: Bearer {'<'}api_key{'>'}" \
            </p>
            <p className="pl-4 text-basalt-foreground">
              -d '{`{"product":"copper","location":"zambia","role":"buyer"}`}'
            </p>
          </div>
          <Link
            to="/docs"
            className="inline-flex items-center gap-1.5 mt-5 text-[13px] font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View full API documentation
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </section>

      {/* Panel 5: Bottom CTA & Footer */}
      <section className="py-14 sm:py-16 px-4 sm:px-6 border-t border-border">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-foreground mb-2">
            Ready to discover counterparties?
          </h2>
          <p className="text-[13px] text-muted-foreground mb-6 leading-relaxed">
            Create an account to generate verified Proof-of-Intentions, access eligibility
            workflows, and progress toward compliant transactions.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 px-5 h-10 bg-primary text-primary-foreground
                         rounded-sm font-medium text-[13px] hover:bg-primary/90 transition-colors"
              >
                Go to Dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <>
                <a
                  href={isPreview ? "/auth" : authUrl}
                  className="inline-flex items-center gap-2 px-5 h-10 bg-primary text-primary-foreground
                           rounded-sm font-medium text-[13px] hover:bg-primary/90 transition-colors"
                >
                  Create Account
                  <ArrowRight className="h-3.5 w-3.5" />
                </a>
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 px-5 h-10 border border-border bg-background
                           rounded-sm font-medium text-[13px] text-foreground hover:bg-muted transition-colors"
                >
                  Developer Access
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <PageFooter />
    </div>
  );
}
