import { useState, useEffect, useCallback } from "react";
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

/** Scan duration for the cryptographic scan phase (Phase 1) */
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
    // Phase 1: Lock inputs, start cryptographic scan
    setIsSearching(true);
    setIsFormLocked(true);
    setHasSearched(true);
    setResults([]);
    setSelectedResults(new Set());
    const queryString = [data.product, data.location].filter(Boolean).join(" ");
    setLastQuery(queryString);

    // Simulate scan duration (1.2s)
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
  }, [isAuthenticated, selectedResults, lastQuery, navigateToAuth]);

  const handlePublishPoi = useCallback(() => {
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
  }, [isAuthenticated, lastQuery, navigateToAuth]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background">
      <PublicHeader />

      {/* Panel 2: Hero Command Center + Governance Panel */}
      <section className="pt-12 sm:pt-16 lg:pt-24 pb-8 sm:pb-12 px-4 sm:px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:border lg:border-border">
            {/* Left: Hero + Search */}
            <div className="lg:col-span-8 lg:border-r lg:border-border">
              <div className="p-4 sm:p-6 lg:p-8">
                <h1 className="text-foreground mb-4 tracking-tighter text-balance max-w-2xl">
                  Discover counterparties. Signal intent.{" "}
                  <br className="hidden sm:inline" />
                  Execute with confidence.
                </h1>
                <p className="text-[13px] font-medium text-foreground/80 mb-1.5">
                  Izenzo API is a next-generation search and governance infrastructure for trade.
                </p>
                <p className="text-[12px] text-muted-foreground mb-8 max-w-lg leading-relaxed">
                  It enables counterparties to discover each other, signal intent, and progress toward
                  compliant transactions across industries and jurisdictions. By combining structured
                  search with Proof-of-Intention (POI), it turns early-stage interest into governed,
                  verifiable pathways to trade.
                </p>
              </div>

              {/* Search form — ledger block */}
              <div className="border-t border-border">
                <BidOfferForm
                  onSearch={handleSearch}
                  isSearching={isSearching}
                  isLocked={isFormLocked}
                />
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
              <GovernancePanel isScanning={isSearching} />
            </aside>
          </div>

          {/* Mobile governance strip */}
          <div className="mt-4 lg:hidden">
            <GovernancePanel isScanning={isSearching} />
          </div>
        </div>
      </section>

      {/* Panel 3: Market Signal Ticker */}
      <CommodityTicker />

      {/* Panel 4a: How It Works */}
      <section id="how-it-works" className="py-16 sm:py-20 px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1280px] mx-auto">
          <h2 className="text-foreground mb-10 tracking-tighter">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-0">
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
            ].map((item, i) => (
              <div
                key={item.step}
                className={`p-6 ${i > 0 ? "sm:border-l border-t sm:border-t-0 border-border" : ""}`}
              >
                <span className="text-[24px] font-mono font-bold text-primary tracking-tighter block mb-3">
                  {item.step}
                </span>
                <h3 className="text-foreground mb-2 tracking-tighter">{item.title}</h3>
                <p className="text-[12px] text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Panel 4b: Developer Access — Obsidian terminal */}
      <DeveloperAccessPanel />

      {/* Panel 5: Bottom CTA & Footer */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 border-t border-border">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-foreground mb-3 tracking-tighter">
            Ready to discover counterparties?
          </h2>
          <p className="text-[12px] text-muted-foreground mb-8 leading-relaxed">
            Create an account to generate verified Proof-of-Intentions, access eligibility
            workflows, and progress toward compliant transactions.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 px-5 h-9 bg-primary text-primary-foreground shadow-inner-metallic
                         font-mono text-[11px] uppercase tracking-widest font-medium hover:opacity-90 transition-opacity"
              >
                Go to Dashboard
                <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <>
                <a
                  href={isPreview ? "/auth" : authUrl}
                  className="inline-flex items-center gap-2 px-5 h-9 bg-primary text-primary-foreground shadow-inner-metallic
                           font-mono text-[11px] uppercase tracking-widest font-medium hover:opacity-90 transition-opacity"
                >
                  Create Account
                  <ArrowRight className="h-3 w-3" />
                </a>
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 px-5 h-9 border border-border bg-background
                           font-mono text-[11px] uppercase tracking-widest font-medium text-foreground hover:bg-accent transition-colors"
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

/** Dark obsidian developer panel with full structured cURL */
function DeveloperAccessPanel() {
  return (
    <section className="py-16 sm:py-20 px-4 sm:px-6 bg-basalt text-basalt-foreground">
      <div className="max-w-[1280px] mx-auto">
        <h2 className="text-basalt-foreground mb-2 tracking-tighter">Developer Access</h2>
        <p className="text-[12px] text-basalt-foreground/50 mb-8 max-w-md leading-relaxed">
          Integrate counterparty discovery, intent signalling, and governance workflows
          directly into your systems via the Izenzo API.
        </p>

        {/* Premium IDE code block */}
        <div className="border border-graphite bg-[hsl(225,20%,4%)] overflow-x-auto">
          {/* Tab bar */}
          <div className="flex items-center gap-0 border-b border-graphite">
            <div className="px-4 py-2 border-r border-graphite bg-basalt">
              <span className="text-[10px] font-mono text-basalt-foreground/60">intent-discover.sh</span>
            </div>
            <div className="px-4 py-2">
              <span className="text-[10px] font-mono text-basalt-foreground/30">response.json</span>
            </div>
          </div>

          {/* Code content */}
          <pre className="p-5 font-mono text-[12px] leading-[1.8] whitespace-pre overflow-x-auto">
            <code>
              {/* Comments */}
              <span className="text-muted-foreground">{"# Initialize governed counterparty discovery"}</span>{"\n"}
              <span className="text-muted-foreground">{"# Requires active API key and valid compliance workspace ID"}</span>{"\n"}
              {"\n"}
              {/* Command */}
              <span className="text-primary">curl</span>
              <span className="text-basalt-foreground">{" -X "}</span>
              <span className="text-primary">POST</span>
              <span className="text-basalt-foreground"> https://api.trade.izenzo.co.za/v1/intent/discover</span>
              <span className="text-basalt-foreground/40">{" \\"}</span>{"\n"}

              {/* Headers */}
              <span className="text-basalt-foreground">{"  -H "}</span>
              <span className="text-signal-verified">{'"Authorization: Bearer sk_live_iz_9a8b7c6d5e4f"'}</span>
              <span className="text-basalt-foreground/40">{" \\"}</span>{"\n"}

              <span className="text-basalt-foreground">{"  -H "}</span>
              <span className="text-signal-verified">{'"Content-Type: application/json"'}</span>
              <span className="text-basalt-foreground/40">{" \\"}</span>{"\n"}

              <span className="text-basalt-foreground">{"  -H "}</span>
              <span className="text-signal-verified">{'"Idempotency-Key: req_01H8X7B2"'}</span>
              <span className="text-basalt-foreground/40">{" \\"}</span>{"\n"}

              {/* JSON payload */}
              <span className="text-basalt-foreground">{"  -d '"}</span>
              <span className="text-basalt-foreground">{"{"}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"    "}</span>
              <span className="text-border">{'"instrument"'}</span>
              <span className="text-basalt-foreground">{": {"}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"product"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"copper_cathode"'}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"volume"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"2500"'}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"unit"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"MT"'}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"target_price"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"USD 8500/MT"'}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"    "}</span>
              <span className="text-basalt-foreground">{"}"}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"    "}</span>
              <span className="text-border">{'"routing"'}</span>
              <span className="text-basalt-foreground">{": {"}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"origin"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"Zambia"'}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"destination_corridor"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"China"'}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"    "}</span>
              <span className="text-basalt-foreground">{"}"}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"    "}</span>
              <span className="text-border">{'"governance"'}</span>
              <span className="text-basalt-foreground">{": {"}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"intent_type"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"buy"'}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"require_kyc_cleared"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-pending">{"true"}</span>
              <span className="text-basalt-foreground">{","}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"      "}</span>
              <span className="text-border">{'"additional_info"'}</span>
              <span className="text-basalt-foreground">{": "}</span>
              <span className="text-signal-verified">{'"Grade A, minimum lot size applies"'}</span>{"\n"}

              <span className="text-basalt-foreground/60">{"    "}</span>
              <span className="text-basalt-foreground">{"}"}</span>{"\n"}

              <span className="text-basalt-foreground">{"  }'"}</span>{"\n"}
              {"\n"}
              {/* Response comment */}
              <span className="text-muted-foreground">{"# Expected Response: 201 Created"}</span>{"\n"}
              <span className="text-muted-foreground">{'# { "status": "liquidity_gap_detected", "poi_eligible": true, "market_hash": "0x4a2b..." }'}</span>
            </code>
          </pre>
        </div>

        <Link
          to="/docs"
          className="inline-flex items-center gap-1.5 mt-6 text-[11px] font-mono uppercase tracking-widest font-medium text-primary hover:text-primary/80 transition-colors"
        >
          View full API documentation
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </section>
  );
}
