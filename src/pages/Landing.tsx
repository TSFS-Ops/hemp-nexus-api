import { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { HeroSection } from "@/components/landing/HeroSection";
import { CommodityTicker } from "@/components/landing/CommodityTicker";
import { CapabilitiesGrid } from "@/components/landing/CapabilitiesGrid";
import { StatsBar } from "@/components/landing/StatsBar";
import { SocialProof } from "@/components/landing/SocialProof";
import { DeveloperAccessPanel } from "@/components/landing/DeveloperAccessPanel";
import { type BidOfferData } from "@/components/landing/BidOfferForm";
import { type DemoSearchResult, getDemoResultsForQuery } from "@/lib/demo-data";
import { savePreAuthState, consumePreAuthState } from "@/lib/pre-auth-state";
import { useAuth } from "@/contexts/AuthContext";

const SCAN_DURATION_MS = 1200;

export default function Landing() {
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DemoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [isFormLocked, setIsFormLocked] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();
  const { isAuthenticated } = useAuth();
  const [searchParams] = useSearchParams();

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

  const handleSearch = useCallback(async (data: BidOfferData) => {
    setIsSearching(true);
    setIsFormLocked(true);
    setHasSearched(true);
    setResults([]);
    setSelectedResults(new Set());
    const queryString = [data.product, data.location].filter(Boolean).join(" ");
    setLastQuery(queryString);
    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS));
    const searchResults = getDemoResultsForQuery(queryString);
    setResults(searchResults);
    setIsSearching(false);
    setIsFormLocked(false);
  }, []);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedResults);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedResults(next);
  };

  const navigateToAuth = useCallback(() => {
    if (isPreview) {
      window.location.assign("/auth?returnTo=/");
    } else {
      window.location.href = authUrl;
    }
  }, [isPreview, authUrl]);

  const handleConfirmIntent = useCallback(() => {
    if (isAuthenticated) {
      toast.success(`Interest confirmed for ${selectedResults.size} counterpart${selectedResults.size > 1 ? "ies" : "y"}.`);
      return;
    }
    savePreAuthState({ query: lastQuery, selectedIds: Array.from(selectedResults), pendingAction: "interested", returnTo: "/" });
    toast.info("Sign in to continue", {
      description: "Create an account to confirm your interest and generate a verified POI.",
      action: { label: "Sign in", onClick: navigateToAuth },
    });
  }, [isAuthenticated, selectedResults, lastQuery, navigateToAuth]);

  const handlePublishPoi = useCallback(() => {
    if (isAuthenticated) {
      toast.success("Your intent has been published as a draft POI.");
      return;
    }
    savePreAuthState({ query: lastQuery, selectedIds: [], pendingAction: "publish_poi", returnTo: "/" });
    toast.info("Sign in to publish intent", {
      description: "Create an account to generate a Proof-of-Intention and attract counterparties.",
      action: { label: "Create Account", onClick: navigateToAuth },
    });
  }, [isAuthenticated, lastQuery, navigateToAuth]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background">
      <PublicHeader />

      {/* Panel 1: Hero — Stat + Headline + Search */}
      <HeroSection
        isSearching={isSearching}
        isFormLocked={isFormLocked}
        results={results}
        hasSearched={hasSearched}
        selectedResults={selectedResults}
        onSearch={handleSearch}
        onToggleSelect={toggleSelect}
        onConfirmIntent={handleConfirmIntent}
        onPublishPoi={handlePublishPoi}
        onSignIn={navigateToAuth}
      />

      {/* Panel 2: Market Signal Ticker */}
      <CommodityTicker />

      {/* Panel 3: Capabilities Grid */}
      <CapabilitiesGrid />

      {/* Panel 4: Stats Bar */}
      <StatsBar />

      {/* Panel 5: Social Proof */}
      <SocialProof />

      {/* Panel 6: How It Works */}
      <section id="how-it-works" className="py-20 sm:py-28 px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1280px] mx-auto">
          <span className="text-[10px] font-mono uppercase tracking-widest text-primary mb-3 block animate-fade-up">
            Workflow
          </span>
          <h2 className="text-foreground mb-12 tracking-tighter animate-fade-up delay-75">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border border-border">
            {[
              { step: "01", title: "Search", desc: "Enter a bid or offer with product, volume, price, and location. The platform searches for verified counterparties across registered data sources." },
              { step: "02", title: "Signal Intent", desc: "Select a counterparty or publish a Proof-of-Intention (POI) to attract interest. Your intent becomes a governed, verifiable signal — not a dead end." },
              { step: "03", title: "Execute", desc: "Progress through eligibility, compliance workflows, and governance checkpoints toward a compliant transaction with tamper-evident proof at every step." },
            ].map((item, i) => (
              <div
                key={item.step}
                className={`p-6 sm:p-8 ${i > 0 ? "sm:border-l border-t sm:border-t-0 border-border" : ""} group hover:bg-accent/20 transition-colors duration-300 animate-fade-up`}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <span className="text-[28px] font-mono font-bold text-primary/80 tracking-tighter block mb-4 group-hover:text-primary transition-colors">
                  {item.step}
                </span>
                <h3 className="text-foreground mb-2.5 tracking-tighter">{item.title}</h3>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Panel 7: Developer Access */}
      <DeveloperAccessPanel />

      {/* Panel 8: Bottom CTA */}
      <section className="py-20 sm:py-28 px-4 sm:px-6 border-t border-border">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-foreground mb-4 tracking-tighter">
            Ready to discover counterparties?
          </h2>
          <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">
            Create an account to generate verified Proof-of-Intentions, access eligibility
            workflows, and progress toward compliant transactions.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
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
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 px-6 h-11 border border-border bg-background
                           font-mono text-[11px] uppercase tracking-widest font-medium text-foreground
                           hover:bg-accent hover:border-foreground/15 transition-all active:scale-[0.98]"
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
