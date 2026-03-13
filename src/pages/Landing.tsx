import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { PageFooter } from "@/components/PageFooter";
import { HeroSection } from "@/components/landing/HeroSection";
import { CommodityTicker } from "@/components/landing/CommodityTicker";
import { MarketSignalsPanel } from "@/components/landing/MarketSignalsPanel";
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

  const authHref = isPreview ? "/auth" : authUrl;

  return (
    <div className="min-h-screen min-h-[100dvh] flex flex-col bg-background relative">
      <AnimatedBackground />
      <PublicHeader />

      {/* Panel 1: Hero — Explanation + Search */}
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

      {/* Panel 3: How It Works — David's 3 steps */}
      <section id="how-it-works" className="py-20 sm:py-28 px-4 sm:px-6 border-t border-border">
        <div className="max-w-[1280px] mx-auto">
          <h2 className="text-foreground mb-4 tracking-tighter animate-fade-up">How to use Izenzo</h2>
          <p className="text-[14px] text-muted-foreground max-w-lg leading-relaxed mb-12 animate-fade-up delay-75">
            Three steps to find a counterparty and produce a Proof-of-Intention.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-0 border border-border">
            {/* Step 1 */}
            <a
              href="#search"
              className="p-6 sm:p-8 group hover:bg-accent/20 transition-colors duration-300 animate-fade-up cursor-pointer"
            >
              <span className="text-[28px] font-mono font-bold text-primary/80 tracking-tighter block mb-3 group-hover:text-primary transition-colors">
                01
              </span>
              <h3 className="text-foreground mb-2 tracking-tighter">Enter your bid or offer</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Describe what you're buying or selling — product, volume, price, and location.
                You can also upload documents to improve match quality.
              </p>
            </a>

            {/* Step 2 */}
            <a
              href="#search"
              className="p-6 sm:p-8 group hover:bg-accent/20 transition-colors duration-300 animate-fade-up sm:border-l border-t sm:border-t-0 border-border cursor-pointer"
              style={{ animationDelay: "70ms" }}
            >
              <span className="text-[28px] font-mono font-bold text-primary/80 tracking-tighter block mb-3 group-hover:text-primary transition-colors">
                02
              </span>
              <h3 className="text-foreground mb-2 tracking-tighter">Run a search to find a match</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Search verified counterparties and see how a Proof-of-Intention (POI) is generated
                when both parties signal interest.
              </p>
            </a>

            {/* Step 3 */}
            <a
              href={authHref}
              className="p-6 sm:p-8 group hover:bg-accent/20 transition-colors duration-300 animate-fade-up sm:border-l border-t sm:border-t-0 border-border cursor-pointer"
              style={{ animationDelay: "140ms" }}
            >
              <span className="text-[28px] font-mono font-bold text-primary/80 tracking-tighter block mb-3 group-hover:text-primary transition-colors">
                03
              </span>
              <h3 className="text-foreground mb-2 tracking-tighter">Create an account to proceed</h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Register to generate a verified POI and proceed to eligibility checks.
                Your account gives you access to the full trade workflow.
              </p>
            </a>
          </div>
        </div>
      </section>

      {/* Panel 4: Market Signals + What Izenzo Does */}
      <section className="py-16 sm:py-20 px-4 sm:px-6 border-t border-border bg-accent/10">
        <div className="max-w-[1280px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: What you get */}
            <div className="lg:col-span-7">
              <h2 className="text-foreground mb-4 tracking-tighter animate-fade-up">What Izenzo does for you</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 border border-border bg-background">
                {[
                  {
                    title: "Find counterparties",
                    desc: "Search across verified sources to find buyers or sellers that match your requirements.",
                  },
                  {
                    title: "Signal your intent",
                    desc: "Publish a Proof-of-Intention — a verified record that you're serious about trading.",
                  },
                  {
                    title: "Stay compliant",
                    desc: "Eligibility checks, sanctions screening, and audit trails are built into every step.",
                  },
                  {
                    title: "Build your evidence",
                    desc: "Generate a tamper-proof evidence pack for every trade — ready for compliance or settlement.",
                  },
                ].map((item, i) => (
                  <div
                    key={item.title}
                    className={`p-5 sm:p-6 animate-fade-up
                               ${i % 2 === 1 ? "sm:border-l border-border" : ""}
                               ${i >= 2 ? "border-t border-border" : ""}`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <h3 className="text-[14px] font-semibold text-foreground mb-1.5 tracking-tight">{item.title}</h3>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right: Market signals panel */}
            <div className="lg:col-span-5">
              <h2 className="text-foreground mb-4 tracking-tighter animate-fade-up">Market signals</h2>
              <MarketSignalsPanel />
            </div>
          </div>
        </div>
      </section>

      {/* Panel 5: Bottom CTA */}
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
          <p className="text-[14px] text-muted-foreground mb-8 leading-relaxed">
            Create a free account to search for counterparties, confirm your intent,
            and produce a verified Proof-of-Intention.
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
                  href={authHref}
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
                  Read the Docs
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
