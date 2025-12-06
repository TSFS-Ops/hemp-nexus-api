import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Search, Shield, Code, ArrowRight, CheckCircle2, ExternalLink } from "lucide-react";

const Landing = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Navigation */}
      <nav className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="font-semibold text-lg">Vericro</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Documentation
            </Link>
            <Link to="/auth">
              <Button variant="outline" size="sm">Sign In</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Shield className="h-4 w-4" />
            Compliance Matching API
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            Intent-verification and counterparty discovery for regulated B2B markets
          </h1>
          <p className="text-lg text-muted-foreground mb-8 max-w-2xl mx-auto">
            A proof-of-intent API that creates tamper-evident records when buyers and sellers express mutual interest. No payments, no contracts — just verifiable proof.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/dashboard">
              <Button size="lg" className="gap-2">
                Try the Demo
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline" className="gap-2">
                Get API Key
                <Code className="h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Value Props */}
      <section className="py-16 px-6 border-t border-border/40">
        <div className="max-w-5xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8">
            <Card className="bg-card/50 border-border/40">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Search className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Search & Discover</h3>
                <p className="text-muted-foreground text-sm">
                  Find regulated buyers and sellers using natural language queries. Our 12% discovery engine surfaces matches that baseline AI misses.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/40">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">Confirm Intent</h3>
                <p className="text-muted-foreground text-sm">
                  Generate tamper-evident proof records when parties express interest. Cryptographic hashes ensure audit trail integrity.
                </p>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/40">
              <CardContent className="pt-6">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                  <Code className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold text-lg mb-2">API or UI</h3>
                <p className="text-muted-foreground text-sm">
                  Integrate via REST API with your existing systems, or use our web interface for manual searches and intent confirmations.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Screenshot Placeholder */}
      <section className="py-16 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
            <div className="bg-muted/50 px-4 py-2 border-b border-border/40 flex items-center gap-2">
              <div className="flex gap-1.5">
                <div className="h-3 w-3 rounded-full bg-destructive/60"></div>
                <div className="h-3 w-3 rounded-full bg-yellow-500/60"></div>
                <div className="h-3 w-3 rounded-full bg-green-500/60"></div>
              </div>
              <span className="text-xs text-muted-foreground font-mono ml-2">api.vericro.co.za/dashboard</span>
            </div>
            <div className="p-8 md:p-12 flex flex-col items-center justify-center min-h-[300px] text-center">
              <Shield className="h-16 w-16 text-muted-foreground/30 mb-4" />
              <p className="text-muted-foreground text-sm">
                Search interface with counterparty results, 12% engine markers, and intent confirmation flow
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* API Examples */}
      <section className="py-16 px-6 border-t border-border/40">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-2">Quick Start</h2>
          <p className="text-muted-foreground text-center mb-10">
            Two endpoints. That's all you need.
          </p>

          <div className="space-y-8">
            {/* Search Example */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-500 text-xs font-mono font-medium">POST</span>
                <code className="text-sm font-mono text-foreground">/search</code>
              </div>
              <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs text-zinc-500 font-mono">curl</span>
                </div>
                <pre className="p-4 overflow-x-auto text-sm">
                  <code className="text-zinc-300 font-mono">{`curl -X POST https://api.vericro.co.za/search \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "query": "buyers for cashew in India",
    "limit": 10
  }'`}</code>
                </pre>
              </div>
            </div>

            {/* Confirm Intent Example */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-500 text-xs font-mono font-medium">POST</span>
                <code className="text-sm font-mono text-foreground">/match/:id/confirm-intent</code>
              </div>
              <div className="rounded-lg bg-zinc-950 border border-zinc-800 overflow-hidden">
                <div className="px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs text-zinc-500 font-mono">curl</span>
                </div>
                <pre className="p-4 overflow-x-auto text-sm">
                  <code className="text-zinc-300 font-mono">{`curl -X POST https://api.vericro.co.za/match/MATCH_ID/confirm-intent \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "counterparty_id": "cp_123",
    "notes": "Interested in Q1 delivery"
  }'`}</code>
                </pre>
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Returns a tamper-evident record with reference ID and cryptographic hash
              </p>
            </div>
          </div>

          <div className="mt-10 text-center">
            <Link to="/docs" className="inline-flex items-center gap-2 text-primary hover:underline">
              View Full Documentation
              <ExternalLink className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-6 border-t border-border/40">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-4">Ready to get started?</h2>
          <p className="text-muted-foreground mb-8">
            Try the demo instantly or sign up for an API key to integrate with your systems.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/dashboard">
              <Button size="lg" className="gap-2 w-full sm:w-auto">
                Try the Demo
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="lg" variant="outline" className="gap-2 w-full sm:w-auto">
                Get API Key
              </Button>
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-6 border-t border-border/40">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-muted-foreground text-sm">
            <Shield className="h-4 w-4" />
            <span>Vericro — Compliance Matching API</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <Link to="/docs" className="hover:text-foreground transition-colors">Documentation</Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
