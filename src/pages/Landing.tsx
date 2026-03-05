import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Search, Handshake, FileCheck, Flame, ShieldCheck, Package, Upload } from "lucide-react";
import { toast } from "sonner";
import { useCrossDomainUrls } from "@/components/HostnameRouter";
import { PublicHeader } from "@/components/PublicHeader";
import { type DemoSearchResult, getDemoResultsForQuery } from "@/lib/demo-data";

export default function Landing() {
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
      description: "Create an account to save your selections and begin the structured handshake.",
      action: {
        label: "Sign in",
        onClick: () => window.location.href = authUrl,
      },
    });
  };

  const AuthLink = ({ children, className }: { children: React.ReactNode; className?: string }) => {
    const authUrl = getAuthUrl();
    if (isPreview) {
      return <Link to="/auth" className={className}>{children}</Link>;
    }
    return <a href={authUrl} className={className}>{children}</a>;
  };

  return (
    <div className="min-h-screen bg-background">
      <PublicHeader showDemo />

      {/* Hero — Thin Trade Layer */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-16 sm:pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-muted/50 text-xs font-medium text-muted-foreground mb-6">
            <Handshake className="h-3.5 w-3.5" />
            Structured Handshake Protocol
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground leading-[1.1] mb-5">
            Search. Match. Agree.<br />Then go deep.
          </h1>
          <p className="text-lg sm:text-xl text-foreground/80 leading-relaxed mb-3">
            Find your counterparty, agree on the basics, and commit — before compliance, due diligence, or governance begins.
          </p>
          <p className="text-base text-muted-foreground leading-relaxed mb-8">
            No long forms. No ownership interrogation. Just product, quantity, price, and delivery terms.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="#try-it"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              Start searching
              <span className="text-background/60 text-xs font-normal">(No login)</span>
            </a>
            <AuthLink className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors">
              Sign in / Create account
            </AuthLink>
          </div>
        </div>
      </section>

      {/* What You Agree On */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-10">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">The basics. Nothing more.</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              At the search and match stage, the information is intentionally minimal. Buyer and seller agree on just enough to move forward.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl mx-auto">
            {[
              { icon: Package, label: "Product", detail: "e.g. gold doré, copper cathode, cashews" },
              { icon: "quantity", label: "Quantity", detail: "Volume and unit of measure" },
              { icon: "price", label: "Price", detail: "Agreed price and currency" },
              { icon: "delivery", label: "Delivery basis", detail: "Incoterms (CIF, FOB, etc.)" },
              { icon: "logistics", label: "Basic logistics", detail: "Outline of shipping arrangement" },
              { icon: Upload, label: "Supporting documents", detail: "COA, proof of product existence" },
            ].map((item) => (
              <div key={item.label} className="flex items-start gap-3 p-4 rounded-lg border border-border bg-background">
                <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                  {typeof item.icon === "string" ? (
                    <span className="text-xs font-bold text-foreground/70">
                      {item.label.charAt(0)}
                    </span>
                  ) : (
                    <item.icon className="h-4 w-4 text-foreground" />
                  )}
                </div>
                <div>
                  <h3 className="font-medium text-foreground text-sm">{item.label}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            No deep compliance yet. No long forms. No ownership interrogation at this stage.
          </p>
        </div>
      </section>

      {/* Try It Now - Embedded Demo Search */}
      <section id="try-it" className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="text-center mb-8">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">Find your counterparty</h2>
            <p className="text-muted-foreground">Search for buyers or sellers — no login required</p>
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
                  aria-label="Search for buyers or sellers"
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

      {/* The Flow — 6 Steps */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="mb-10">
            <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-2">The flow</h2>
            <p className="text-muted-foreground">Simple to complex. Earn trust before demanding it.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                step: "1",
                icon: Search,
                title: "Search",
                description: "Find counterparties by product, region, or trade corridor. Natural language or structured queries."
              },
              {
                step: "2",
                icon: Handshake,
                title: "Match",
                description: "Select a counterparty. Both sides see the same minimal deal terms — product, quantity, price, delivery."
              },
              {
                step: "3",
                icon: FileCheck,
                title: "Agree in Principle",
                description: "Upload supporting commercial documents (COA, proof of product). Both parties signal willingness."
              },
              {
                step: "4",
                icon: ShieldCheck,
                title: "Commit",
                description: "Confirm Intent creates an immutable, timestamped, hash-verified record of mutual agreement."
              },
              {
                step: "5",
                icon: Flame,
                title: "Burn First Token",
                description: "A credit is consumed to seal the proof-of-intent. This is the cost of commitment — skin in the game."
              },
              {
                step: "6",
                icon: ArrowRight,
                title: "Enter Governance",
                description: "Only now does the deep layer begin: KYC, due diligence, UBO verification, and compliance checks."
              },
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

      {/* Clarity Section */}
      <section className="border-t border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20">
          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <h3 className="font-semibold text-foreground mb-2">Not a compliance portal</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                The front end is deliberately simple. Compliance depth comes after commitment, not before.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">Not a data room</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                No document dumps, no regulatory interrogation upfront. Upload only what proves the product exists.
              </p>
            </div>
            <div>
              <h3 className="font-semibold text-foreground mb-2">A structured handshake</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Two parties agree on fundamentals. The system records it immutably. Everything else follows.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-border bg-muted/30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center">
          <h2 className="text-xl sm:text-2xl font-semibold text-foreground mb-3">Ready to find your counterparty?</h2>
          <p className="text-muted-foreground mb-8 max-w-lg mx-auto">
            Start with a search. Agree on the basics. Commit when you're ready. Governance comes after.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <AuthLink className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors">
              Create account
              <ArrowRight className="h-4 w-4" />
            </AuthLink>
            <Link
              to="/docs"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
            >
              Read documentation
            </Link>
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
