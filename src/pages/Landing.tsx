import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Search, CheckCircle, FileText, Shield, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { type DemoSearchResult, getDemoResultsForQuery } from "@/lib/demo-data";

export default function Landing() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<DemoSearchResult[]>([]);
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [hasSearched, setHasSearched] = useState(false);
  const { getAuthUrl, isPreview } = useCrossDomainUrls();
  const authUrl = getAuthUrl();

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setHasSearched(true);
    await new Promise(resolve => setTimeout(resolve, 800));
    setResults(getDemoResultsForQuery(query));
    setIsSearching(false);
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedResults);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedResults(newSelected);
  };

  const handleConfirmIntent = () => {
    toast.info("Sign in to confirm intent", {
      description: "Create an account to save your selections and generate evidence packs.",
      action: {
        label: "Sign in",
        onClick: () => window.location.href = authUrl,
      },
    });
  };
  
  // Helper to handle auth navigation (cross-domain or internal)
  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    const authUrl = getAuthUrl();
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border bg-background sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
              <span className="text-background font-bold text-xs">CM</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">Compliance Matching API</span>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-6">
            <Link 
              to="/docs" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Documentation
            </Link>
            <Link 
              to="/pricing" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Pricing
            </Link>
            <a 
              href="#try-it" 
              className="text-sm font-medium text-foreground"
            >
              Try Demo
            </a>
            <AuthLink className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors">
              Sign in
              <ArrowRight className="h-3.5 w-3.5" />
            </AuthLink>
          </div>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 py-4 space-y-3">
            <Link 
              to="/docs" 
              className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Documentation
            </Link>
            <Link 
              to="/pricing" 
              className="block text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Pricing
            </Link>
            <a 
              href="#try-it" 
              className="block text-sm font-medium text-foreground py-2"
              onClick={() => setMobileMenuOpen(false)}
            >
              Try Demo
            </a>
            <AuthLink className="block text-sm font-medium text-foreground py-2">
              Sign in
            </AuthLink>
          </div>
        )}
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-20">
        <div className="max-w-3xl">
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground leading-[1.1] mb-5">
            Prove trade intent with tamper-evident records
          </h1>
          <p className="text-lg sm:text-xl text-foreground/80 leading-relaxed mb-3">
            Search for counterparties, record proof-of-intent, and generate audit trails regulators can verify.
          </p>
          <p className="text-base text-muted-foreground leading-relaxed mb-8">
            For developers building regulated B2B marketplaces, brokerage platforms, and procurement systems.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <a 
              href="#try-it"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              Try it now
              <span className="text-background/60 text-xs font-normal">(No login)</span>
            </a>
            <AuthLink className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors">
              Sign in / Create API Key
            </AuthLink>
          </div>
        </div>
      </section>

      {/* Try It Now - Embedded Demo Search */}
      <section id="try-it" className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">Try it now</h2>
            <p className="text-muted-foreground">Search for counterparties — no login required</p>
          </div>

          <div className="max-w-2xl mx-auto">
            <div className="rounded-xl border border-border bg-background p-6 sm:p-8">
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="e.g., 'buyers for cashew in India' or 'copper cathode suppliers'"
                  aria-label="Search for verified buyers or sellers"
                  className="w-full h-14 px-5 text-base bg-muted/50 border border-border rounded-xl 
                           placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 
                           focus:ring-primary/30 focus:border-primary/40 transition-all"
                />
              </div>

              <button
                onClick={handleSearch}
                disabled={isSearching || !query.trim()}
                className="mt-4 w-full h-12 min-h-[44px] bg-foreground hover:bg-foreground/90 text-background 
                         rounded-xl font-medium text-sm transition-colors disabled:opacity-50 
                         disabled:cursor-not-allowed"
              >
                {isSearching ? "Searching..." : "Search Counterparties"}
              </button>

              {/* Results */}
              {hasSearched && (
                <div className="mt-6 space-y-3">
                  {isSearching ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 rounded-lg shimmer" style={{ animationDelay: `${i * 0.1}s` }} />
                      ))}
                    </div>
                  ) : results.length > 0 ? (
                    <>
                      {results.map((result) => (
                        <button
                          key={result.id}
                          onClick={() => toggleSelect(result.id)}
                          aria-pressed={selectedResults.has(result.id)}
                          className={`w-full text-left p-4 rounded-lg border transition-all min-h-[44px]
                                    focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                            selectedResults.has(result.id)
                              ? "bg-primary/5 border-primary/20"
                              : "bg-muted/30 border-border hover:bg-muted/50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-foreground truncate">{result.title}</h3>
                              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{result.description}</p>
                            </div>
                            <div
                              className={`w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-colors ${
                                selectedResults.has(result.id)
                                  ? "bg-primary border-primary"
                                  : "border-muted-foreground/30"
                              }`}
                              aria-hidden="true"
                            >
                              {selectedResults.has(result.id) && (
                                <svg className="w-full h-full text-primary-foreground" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                </svg>
                              )}
                            </div>
                          </div>
                        </button>
                      ))}

                      {selectedResults.size > 0 && (
                        <button
                          onClick={handleConfirmIntent}
                          className="mt-4 w-full h-11 min-h-[44px] bg-primary hover:bg-primary/90 text-primary-foreground 
                                   rounded-lg font-medium text-sm transition-colors
                                   focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                        >
                          Confirm Intent ({selectedResults.size})
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="text-center text-sm text-muted-foreground py-8">
                      No results found. Try a different search term.
                    </p>
                  )}
                </div>
              )}
            </div>

            <p className="mt-4 text-center text-xs text-muted-foreground">
              No obligation. No payment. Signals intent only.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works - 4 Step Flow */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="mb-10">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">How it works</h2>
            <p className="text-muted-foreground">Four steps from search to verifiable proof</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                step: "1",
                icon: Search,
                title: "Search",
                description: "Query for counterparties using natural language. Get ranked results with confidence scores."
              },
              {
                step: "2",
                icon: CheckCircle,
                title: "Review",
                description: "Evaluate results enriched by the Discovery Engine. See why each counterparty was surfaced."
              },
              {
                step: "3",
                icon: Shield,
                title: "Confirm Intent",
                description: "Record buyer-seller interest with a single API call. Creates timestamped, hash-verified proof."
              },
              {
                step: "4",
                icon: FileText,
                title: "Evidence Pack",
                description: "Export tamper-evident audit trails for compliance reviews and regulatory reporting."
              }
            ].map((item) => (
              <div key={item.step} className="relative">
                <div className="flex flex-col h-full p-5 rounded-lg border border-border bg-background">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                      <item.icon className="h-4 w-4 text-foreground" />
                    </div>
                    <span className="text-xs font-mono text-muted-foreground">Step {item.step}</span>
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Key Differentiators */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h3 className="font-semibold text-foreground mb-2">Information only</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Confirm Intent records interest between parties. No payment processing, no contract execution, no legal obligations created.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">Tamper-evident audit trail</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Every event is SHA-256 hashed and chain-linked. Evidence packs are cryptographically verifiable for compliance and dispute resolution.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">Discovery Engine</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Baseline search enhanced by supply chain adjacency, regional heuristics, and semantic expansion. Typically adds 12%+ relevant results.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* API Example */}
      <section className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="mb-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">Quick start</h2>
            <p className="text-muted-foreground">Confirm trade intent with a single API call</p>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <div className="border-b border-border px-4 py-2.5 bg-muted/50 flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-mono">POST /v1/match</span>
              <Link to="/docs" className="text-xs text-primary hover:underline">
                Full documentation →
              </Link>
            </div>
            <pre className="p-4 text-sm text-foreground overflow-x-auto font-mono">
              <code>{`curl -X POST https://api.trade.izenzo.co.za/v1/match \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "buyer_id": "org_abc",
    "seller_id": "org_xyz",
    "commodity": "cashew",
    "quantity": { "amount": 1000, "unit": "MT" },
    "price": { "amount": 1250, "currency": "USD" }
  }'

# Response
{
  "id": "match_8f3k2j",
  "status": "confirmed",
  "created_at": "2025-01-11T10:30:00Z",
  "hash": "sha256:f4b2a1c9...",
  "note": "Intent recorded. No legal obligation created."
}`}</code>
            </pre>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link 
              to="/docs"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
            >
              Read documentation
            </Link>
            <AuthLink className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors">
              Create API key
              <ArrowRight className="h-4 w-4" />
            </AuthLink>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>Compliance Matching API</span>
          <div className="flex items-center gap-6">
            <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link>
            <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link to="/demo" className="hover:text-foreground transition-colors">Demo</Link>
            <AuthLink className="hover:text-foreground transition-colors">Sign in</AuthLink>
          </div>
        </div>
      </footer>
    </div>
  );
}
