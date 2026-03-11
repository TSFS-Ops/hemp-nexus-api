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
      <PublicHeader />

      {/* ─── Panel 1: Hero / Entry ─── */}
      <section className="pt-12 sm:pt-16 lg:pt-20 pb-8 sm:pb-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
            {/* Left column: Hero + Search */}
            <div className="lg:col-span-8">
              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight text-foreground leading-tight mb-3">
                Discover counterparties. Signal intent.<br className="hidden sm:inline" /> Execute with confidence.
              </h1>
              <p className="text-sm sm:text-base font-medium text-foreground/80 mb-2">
                Izenzo API is a next-generation search and governance infrastructure for trade.
              </p>
              <p className="text-sm text-muted-foreground mb-8 max-w-2xl leading-relaxed">
                It enables counterparties to discover each other, signal intent, and progress toward
                compliant transactions across industries and jurisdictions. By combining structured
                search with Proof-of-Intention (POI), it turns early-stage interest into governed,
                verifiable pathways to trade.
              </p>

              {/* Bid/Offer form */}
              <div className="border border-border rounded-lg p-4 sm:p-6 bg-card">
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

            {/* Right column: Governance panel (Bloomberg RHS) */}
            <aside className="lg:col-span-4">
              <GovernancePanel />
            </aside>
          </div>
        </div>
      </section>

      {/* ─── Bloomberg bottom ticker ─── */}
      <CommodityTicker />

      {/* ─── Panel 2: System Purpose ─── */}
      <section id="how-it-works" className="py-16 sm:py-20 px-4 sm:px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-6">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
                <span className="text-xs font-mono font-semibold text-primary">{item.step}</span>
                <h3 className="text-base font-semibold text-foreground">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Panel 3: How to Use the API ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-muted/30 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-3">Developer Access</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-2xl leading-relaxed">
            Integrate counterparty discovery, intent signalling, and governance workflows
            directly into your systems via the Izenzo API.
          </p>
          <div className="border border-border rounded-lg bg-card p-5 font-mono text-sm">
            <p className="text-muted-foreground mb-1"># Search for counterparties</p>
            <p className="text-foreground">
              <span className="text-primary">curl</span> -X POST https://api.trade.izenzo.co.za/v1/search \
            </p>
            <p className="text-foreground pl-4">
              -H "Authorization: Bearer {'<'}api_key{'>'}" \
            </p>
            <p className="text-foreground pl-4">
              -d '{`{"product":"copper","location":"zambia","role":"buyer"}`}'
            </p>
          </div>
          <Link
            to="/docs"
            className="inline-flex items-center gap-1.5 mt-4 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            View full API documentation
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </section>

      {/* ─── Panel 4: Signals & Governance (anchor for nav) ─── */}
      <section id="signals" className="py-16 sm:py-20 px-4 sm:px-6 border-t border-border">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-3">Indicative Market Signals</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-2xl leading-relaxed">
            Platform signals across infrastructure and sustainable development commodities.
            Indicative data — representative of intent activity patterns on the platform.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { asset: "Soybeans", signal: "Buyer interest", corridor: "Brazil → East Africa" },
              { asset: "Carbon Credits", signal: "Seller signal", corridor: "Kenya" },
              { asset: "CDRs", signal: "Buyer intent", corridor: "Global" },
              { asset: "Copper", signal: "Seller signal", corridor: "Zambia → China" },
              { asset: "Lithium", signal: "Buyer interest", corridor: "DRC → Europe" },
              { asset: "Nickel", signal: "Seller signal", corridor: "Indonesia" },
              { asset: "Manganese", signal: "Buyer intent", corridor: "SA → India" },
              { asset: "Cobalt", signal: "Seller signal", corridor: "DRC → Japan" },
            ].map((s) => (
              <div key={s.asset} className="border border-border rounded-md p-3 bg-card">
                <p className="text-sm font-semibold text-foreground">{s.asset}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.signal}</p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">{s.corridor}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-3">
            Indicative signals. Not live exchange data. Updated periodically.
          </p>
        </div>
      </section>

      {/* ─── Panel 5: Conversion / Access ─── */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 bg-muted/30 border-t border-border">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-3">
            Ready to discover counterparties?
          </h2>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            Create an account to generate verified Proof-of-Intentions, access eligibility
            workflows, and progress toward compliant transactions.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 px-6 h-11 bg-primary text-primary-foreground
                         rounded-md font-medium text-sm hover:bg-primary/90 transition-colors"
              >
                Go to Dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <a
                  href={isPreview ? "/auth" : authUrl}
                  className="inline-flex items-center gap-2 px-6 h-11 bg-primary text-primary-foreground
                           rounded-md font-medium text-sm hover:bg-primary/90 transition-colors"
                >
                  Create Account
                  <ArrowRight className="h-4 w-4" />
                </a>
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 px-6 h-11 border border-input bg-background
                           rounded-md font-medium text-sm text-foreground hover:bg-muted transition-colors"
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
