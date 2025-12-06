import { Link } from "react-router-dom";
import { ArrowRight, Terminal, Database, FileCheck, ChevronRight } from "lucide-react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <nav className="border-b border-border/60 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded bg-foreground flex items-center justify-center">
              <span className="text-background font-bold text-xs">CM</span>
            </div>
            <span className="font-semibold text-sm tracking-tight">Compliance Match</span>
          </div>
          <div className="flex items-center gap-6">
            <Link 
              to="/docs" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Docs
            </Link>
            <Link 
              to="/demo" 
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Demo
            </Link>
            <Link 
              to="/auth"
              className="text-sm font-medium text-foreground hover:text-primary transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground mb-4 tracking-wide uppercase">
            Developer API
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-foreground leading-[1.1] mb-6">
            Proof-of-intent matching for regulated B2B commerce
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed mb-8 max-w-2xl">
            Search counterparties, confirm trade intent, and generate tamper-evident audit trails. 
            Built for compliance teams in commodities, manufacturing, and cross-border trade.
          </p>
          <div className="flex items-center gap-3">
            <Link 
              to="/demo"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
            >
              Try demo
            </Link>
            <Link 
              to="/auth"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              Get API key
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-t border-border/60 bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="grid md:grid-cols-3 gap-8">
            <div className="space-y-3">
              <div className="h-9 w-9 rounded-md bg-background border border-border flex items-center justify-center">
                <Terminal className="h-4 w-4 text-foreground" />
              </div>
              <h3 className="font-semibold text-foreground">Search API</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Natural language search across multiple data sources. Returns ranked counterparties with confidence scores.
              </p>
            </div>

            <div className="space-y-3">
              <div className="h-9 w-9 rounded-md bg-background border border-border flex items-center justify-center">
                <Database className="h-4 w-4 text-foreground" />
              </div>
              <h3 className="font-semibold text-foreground">Intent Confirmation</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Record buyer-seller interest with a single API call. Creates timestamped, hash-verified proof of intent.
              </p>
            </div>

            <div className="space-y-3">
              <div className="h-9 w-9 rounded-md bg-background border border-border flex items-center justify-center">
                <FileCheck className="h-4 w-4 text-foreground" />
              </div>
              <h3 className="font-semibold text-foreground">Evidence Packs</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Export tamper-evident audit trails for compliance reviews, dispute resolution, and regulatory reporting.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Interface Preview */}
      <section className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-foreground mb-2">Interface Preview</h2>
            <p className="text-muted-foreground">Search results with discovery engine enrichment</p>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            {/* Window chrome */}
            <div className="border-b border-border px-4 py-2.5 bg-muted/50 flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-full bg-border" />
                <div className="h-2.5 w-2.5 rounded-full bg-border" />
                <div className="h-2.5 w-2.5 rounded-full bg-border" />
              </div>
              <span className="text-xs text-muted-foreground ml-2 font-mono">dashboard</span>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {/* Search input mockup */}
              <div className="flex gap-3">
                <div className="flex-1 h-10 bg-muted rounded-md border border-border flex items-center px-3">
                  <span className="text-sm text-muted-foreground">buyers for cashew in India</span>
                </div>
                <div className="h-10 px-4 bg-foreground text-background rounded-md flex items-center text-sm font-medium">
                  Search
                </div>
              </div>

              {/* Results */}
              <div className="space-y-2">
                {[
                  { name: "GlobalAgri Trading Co.", score: 94, enriched: true },
                  { name: "IndiaExport Partners Ltd.", score: 89, enriched: false },
                  { name: "SouthAsia Commodities GmbH", score: 85, enriched: true },
                ].map((result, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-md border border-border bg-background">
                    <div className="h-7 w-7 rounded bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium text-foreground">{result.name}</div>
                      <div className="text-xs text-muted-foreground">Match score: {result.score}%</div>
                    </div>
                    {result.enriched && (
                      <span className="px-2 py-0.5 text-xs font-medium rounded bg-muted text-muted-foreground border border-border">
                        +12%
                      </span>
                    )}
                    <button className="px-3 py-1.5 text-xs font-medium rounded border border-border bg-background hover:bg-accent transition-colors">
                      Confirm
                    </button>
                  </div>
                ))}
              </div>

              {/* Metrics bar */}
              <div className="flex items-center justify-between p-3 rounded-md bg-muted/50 border border-border">
                <div className="flex items-center gap-6 text-sm">
                  <div>
                    <span className="text-muted-foreground">Baseline: </span>
                    <span className="font-medium text-foreground">15</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total: </span>
                    <span className="font-medium text-foreground">21</span>
                  </div>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">Discovery uplift: </span>
                  <span className="font-medium text-foreground">+40%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* API Example */}
      <section className="border-t border-border/60 bg-muted/30">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-foreground mb-2">Quick Start</h2>
            <p className="text-muted-foreground">Confirm trade intent with a single API call</p>
          </div>

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <div className="border-b border-border px-4 py-2.5 bg-muted/50 flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-mono">POST /v1/match/:id/settle</span>
              <Link to="/docs" className="text-xs text-primary hover:underline flex items-center gap-1">
                Full docs
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <pre className="p-4 text-sm text-foreground overflow-x-auto">
              <code>{`curl -X POST https://api.compliancematch.dev/v1/match/m_abc123/settle \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"

# Response
{
  "id": "m_abc123",
  "status": "settled",
  "settled_at": "2025-01-15T10:30:00Z",
  "hash": "sha256:f4b2a1...",
  "note": "Intent confirmed - no legal obligation created"
}`}</code>
            </pre>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link 
              to="/docs"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md border border-border bg-background hover:bg-accent transition-colors"
            >
              Read documentation
            </Link>
            <Link 
              to="/auth"
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-md bg-foreground text-background hover:bg-foreground/90 transition-colors"
            >
              Create account
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/60">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-sm text-muted-foreground">
          <span>Compliance Match API</span>
          <div className="flex items-center gap-6">
            <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link>
            <Link to="/demo" className="hover:text-foreground transition-colors">Demo</Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}