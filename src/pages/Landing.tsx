import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
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
import { AnimatedBackground } from "@/components/landing/AnimatedBackground";
import { type BidOfferData } from "@/components/landing/BidOfferForm";
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

    // If authenticated, redirect to real search in the console
    if (isAuthenticated) {
      const params = new URLSearchParams({ q: queryString });
      window.location.assign(`/dashboard/search?${params.toString()}`);
      return;
    }

    // Unauthenticated: show scanning animation then gate behind sign-in
    setIsSearching(true);
    setIsFormLocked(true);
    setHasSearched(true);
    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS));
    setIsSearching(false);
    setIsFormLocked(false);
  }, [isAuthenticated]);

  const handleConfirmIntent = useCallback(() => {
    if (isAuthenticated) {
      const params = new URLSearchParams({ q: lastQuery });
      window.location.assign(`/dashboard/search?${params.toString()}`);
      return;
    }
    savePreAuthState({ query: lastQuery, selectedIds: [], pendingAction: "interested", returnTo: "/" });
    toast.info("Sign in to continue", {
      description: "Create an account to search for real counterparties and confirm intent.",
      action: { label: "Sign in", onClick: navigateToAuth },
    });
  }, [isAuthenticated, lastQuery, navigateToAuth]);

  const handlePublishPoi = useCallback(() => {
    if (isAuthenticated) {
      const params = new URLSearchParams({ q: lastQuery });
      window.location.assign(`/dashboard/search?${params.toString()}`);
      return;
    }
    savePreAuthState({ query: lastQuery, selectedIds: [], pendingAction: "publish_poi", returnTo: "/" });
    toast.info("Sign in to publish intent", {
      description: "Create an account to search for real counterparties and publish a Proof-of-Intent.",
      action: { label: "Create Account", onClick: navigateToAuth },
    });
  }, [isAuthenticated, lastQuery, navigateToAuth]);

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background relative">
      <AnimatedBackground />
      <PublicHeader />

      {/* Panel 1: Hero — Stat + Headline + Search */}
      <HeroSection
        isSearching={isSearching}
        isFormLocked={isFormLocked}
        hasSearched={hasSearched}
        onSearch={handleSearch}
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
              { step: "01", title: "Search", desc: "Describe what you're looking for — product, volume, price, and location. Izenzo searches verified counterparty sources and returns ranked results." },
              { step: "02", title: "Match & Signal", desc: "Select a counterparty and create a match. When you're ready, confirm your intent — a verifiable, auditable record that signals serious interest." },
              { step: "03", title: "Evidence & Compliance", desc: "Upload documents, complete compliance checks, and download a tamper-evident evidence pack for your records. Every step is hashed and chain-linked." },
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
      <section className="relative py-20 sm:py-28 px-4 sm:px-6 border-t border-border overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full blur-[150px] opacity-[0.05] pointer-events-none"
          aria-hidden="true"
          style={{ background: `hsl(var(--primary))` }}
        />
        <div className="max-w-xl mx-auto text-center relative z-10">
          <h2 className="text-foreground mb-4 tracking-tighter">
            Ready to find your next counterparty?
          </h2>
          <p className="text-[13px] text-muted-foreground mb-8 leading-relaxed">
            Create an account to search for verified counterparties, confirm intent,
            and build compliance-ready evidence packs — all in one place.
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
