import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  Shield, Search, CheckCircle, FileText, Zap, 
  ArrowRight, Code, Play, Users, Lock, TrendingUp 
} from "lucide-react";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Navigation */}
      <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <span className="font-bold text-xl">Compliance Matching API</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/docs" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Documentation
            </Link>
            <Link to="/demo">
              <Button variant="outline" size="sm">
                <Play className="h-4 w-4 mr-2" />
                Try Demo
              </Button>
            </Link>
            <Link to="/auth">
              <Button size="sm">Sign Up</Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-24 text-center">
        <Badge variant="secondary" className="mb-4">
          Proof-of-Intent API for Regulated B2B
        </Badge>
        <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 max-w-4xl mx-auto">
          Tamper-Evident Intent Matching for{" "}
          <span className="text-primary">Regulated Commodities</span>
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
          Find, match, and prove buyer-seller intent with cryptographic audit trails. 
          No payments, no contracts — just verified, timestamped expressions of interest.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/demo">
            <Button size="lg" variant="outline">
              <Play className="h-5 w-5 mr-2" />
              Try Demo (No Login)
            </Button>
          </Link>
          <Link to="/auth">
            <Button size="lg">
              Get Started
              <ArrowRight className="h-5 w-5 ml-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* What It Does */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">What the API Does</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            A compliance-first API for regulated B2B matching with full audit trails
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          <Card>
            <CardHeader>
              <Search className="h-10 w-10 text-primary mb-2" />
              <CardTitle>Search Counterparties</CardTitle>
              <CardDescription>
                Natural language search for buyers or sellers across multiple data sources
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <CheckCircle className="h-10 w-10 text-primary mb-2" />
              <CardTitle>Confirm Intent</CardTitle>
              <CardDescription>
                Record interest with a single click — no payment, no contract, just proof
              </CardDescription>
            </CardHeader>
          </Card>

          <Card>
            <CardHeader>
              <Shield className="h-10 w-10 text-primary mb-2" />
              <CardTitle>Evidence Packs</CardTitle>
              <CardDescription>
                Tamper-evident, hash-chained audit logs for regulatory compliance
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </section>

      {/* Screenshot / UI Preview */}
      <section className="container mx-auto px-4 py-16">
        <Card className="overflow-hidden border-2 max-w-4xl mx-auto">
          <CardHeader className="bg-muted/50 border-b">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-destructive" />
              <div className="w-3 h-3 rounded-full bg-yellow-500" />
              <div className="w-3 h-3 rounded-full bg-green-500" />
              <span className="ml-4 text-sm text-muted-foreground">Dashboard Preview</span>
            </div>
          </CardHeader>
          <CardContent className="p-6 bg-gradient-to-br from-muted/30 to-muted/50">
            <div className="space-y-4">
              {/* Search Bar Preview */}
              <div className="bg-background rounded-lg border p-4">
                <div className="flex gap-3">
                  <div className="flex-1 h-10 bg-muted rounded border flex items-center px-3">
                    <span className="text-muted-foreground text-sm">
                      "buyers for cashew in India"
                    </span>
                  </div>
                  <div className="h-10 px-4 bg-primary text-primary-foreground rounded flex items-center gap-2 text-sm">
                    <Search className="h-4 w-4" />
                    Search
                  </div>
                </div>
              </div>

              {/* Results Preview */}
              <div className="grid gap-3">
                {[
                  { title: "GlobalAgri Trading Co.", score: 94, enriched: true },
                  { title: "IndiaExport Partners Ltd.", score: 89, enriched: false },
                  { title: "SouthAsia Commodities", score: 85, enriched: true },
                ].map((result, i) => (
                  <div key={i} className="bg-background rounded-lg border p-3 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-bold">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{result.title}</div>
                      <div className="text-xs text-muted-foreground">Score: {result.score}%</div>
                    </div>
                    {result.enriched && (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 text-xs">
                        <Zap className="h-3 w-3 mr-1" />
                        12%
                      </Badge>
                    )}
                    <Button size="sm" variant="outline" className="text-xs">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Confirm Intent
                    </Button>
                  </div>
                ))}
              </div>

              {/* Metrics Preview */}
              <div className="bg-primary/10 rounded-lg border border-primary/20 p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-lg font-bold">15</div>
                    <div className="text-xs text-muted-foreground">Baseline</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">21</div>
                    <div className="text-xs text-muted-foreground">Total</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-green-600 font-bold">+40%</span>
                  <span className="text-xs text-muted-foreground">12% Engine Uplift</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* How It Works */}
      <section className="container mx-auto px-4 py-16 bg-muted/30">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">How It Works</h2>
        </div>

        <div className="max-w-3xl mx-auto">
          <div className="space-y-8">
            {[
              {
                step: "1",
                title: "Search",
                description: "Enter a natural language query like 'buyers for copper cathode' to find matching counterparties",
                icon: Search,
              },
              {
                step: "2",
                title: "Review",
                description: "See ranked results with 12% Engine enrichment that finds matches AI alone misses",
                icon: Users,
              },
              {
                step: "3",
                title: "Confirm Intent",
                description: "Click to record your interest — this creates a timestamped, hash-verified proof of intent",
                icon: CheckCircle,
              },
              {
                step: "4",
                title: "Audit Trail",
                description: "Access tamper-evident evidence packs for compliance and dispute resolution",
                icon: FileText,
              },
            ].map((item, i) => (
              <div key={i} className="flex gap-4 items-start">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold flex-shrink-0">
                  {item.step}
                </div>
                <div>
                  <h3 className="font-semibold mb-1 flex items-center gap-2">
                    <item.icon className="h-4 w-4 text-primary" />
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Developer Section */}
      <section className="container mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Built for Developers</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            RESTful API with clear endpoints, comprehensive docs, and examples in curl, Python, and Node.js
          </p>
        </div>

        <Card className="max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Quick Example
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
              <code>{`curl -X POST /v1/match/:id/settle \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json"

# Response:
{
  "id": "match_abc123",
  "status": "settled",
  "settled_at": "2025-01-15T10:30:00Z",
  "hash": "sha256:abc123...",
  "note": "Intent confirmed - no legal obligation"
}`}</code>
            </pre>
            <div className="mt-4">
              <Link to="/docs">
                <Button variant="outline">
                  <FileText className="h-4 w-4 mr-2" />
                  View Full Documentation
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-4 py-24">
        <Card className="bg-primary text-primary-foreground max-w-3xl mx-auto text-center">
          <CardContent className="py-12">
            <Lock className="h-12 w-12 mx-auto mb-4 opacity-90" />
            <h2 className="text-2xl font-bold mb-4">Ready to Start Matching?</h2>
            <p className="mb-6 opacity-90 max-w-md mx-auto">
              Create a free account to access full search capabilities and create verified proofs of intent.
            </p>
            <div className="flex items-center justify-center gap-4">
              <Link to="/demo">
                <Button variant="secondary" size="lg">
                  <Play className="h-5 w-5 mr-2" />
                  Try Demo First
                </Button>
              </Link>
              <Link to="/auth">
                <Button variant="outline" size="lg" className="bg-transparent border-primary-foreground text-primary-foreground hover:bg-primary-foreground hover:text-primary">
                  Sign Up Free
                  <ArrowRight className="h-5 w-5 ml-2" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Footer */}
      <footer className="border-t py-8">
        <div className="container mx-auto px-4 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            <span>Compliance Matching API</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <Link to="/demo" className="hover:text-foreground transition-colors">Demo</Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
