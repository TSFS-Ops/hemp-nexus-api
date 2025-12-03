import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Copy, Check, Shield, FileCheck, ExternalLink } from "lucide-react";
import { toast } from "sonner";

const EmbeddableWidget = () => {
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  const copyToClipboard = (code: string, snippetId: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSnippet(snippetId);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const reactWidgetCode = `// ComplianceMatchWidget.tsx
import React, { useState } from 'react';

interface MatchProof {
  id: string;
  hash: string;
  status: string;
  created_at: string;
}

interface DealData {
  buyer: { id: string; name: string };
  seller: { id: string; name: string };
  commodity: string;
  quantity: { amount: number; unit: string };
  price: { amount: number; currency: string };
  terms?: string;
}

export const ComplianceMatchWidget = ({ 
  apiEndpoint,
  onMatchCreated 
}: { 
  apiEndpoint: string;
  onMatchCreated?: (proof: MatchProof) => void;
}) => {
  const [proof, setProof] = useState<MatchProof | null>(null);
  const [loading, setLoading] = useState(false);

  const recordMatch = async (deal: DealData) => {
    setLoading(true);
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deal)
      });
      const data = await response.json();
      setProof(data);
      onMatchCreated?.(data);
    } catch (error) {
      console.error('Failed to record match:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="compliance-widget">
      {proof ? (
        <div className="proof-badge">
          <span className="verified-icon">✓</span>
          <div>
            <strong>Verified Agreement</strong>
            <code>{proof.hash.slice(0, 16)}...</code>
          </div>
        </div>
      ) : (
        <button onClick={() => recordMatch(yourDealData)} disabled={loading}>
          {loading ? 'Recording...' : 'Record Agreement'}
        </button>
      )}
    </div>
  );
};`;

  const backendCode = `// Your backend API route (Node.js/Express example)
// /api/record-match.js

const TRADE_IZENZO_API = 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response = await fetch(TRADE_IZENZO_API, {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.TRADE_IZENZO_API_KEY, // Store securely!
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error('Trade.Izenzo API error:', error);
    return res.status(500).json({ error: 'Failed to record match' });
  }
}`;

  const cssCode = `.compliance-widget {
  font-family: system-ui, -apple-system, sans-serif;
}

.proof-badge {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  border-radius: 8px;
  color: white;
}

.verified-icon {
  width: 32px;
  height: 32px;
  background: rgba(255,255,255,0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.proof-badge code {
  display: block;
  font-size: 12px;
  opacity: 0.9;
  font-family: monospace;
}

.proof-badge strong {
  display: block;
  font-size: 14px;
  margin-bottom: 2px;
}`;

  const htmlEmbedCode = `<!-- Add to your HTML -->
<div id="compliance-match-widget"></div>

<script>
  // Initialize the widget
  window.ComplianceMatch = {
    apiEndpoint: '/api/record-match', // Your backend endpoint
    
    async recordMatch(deal) {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deal)
      });
      return response.json();
    },
    
    renderProof(containerId, proof) {
      const container = document.getElementById(containerId);
      container.innerHTML = \`
        <div class="proof-badge">
          <span class="verified-icon">✓</span>
          <div>
            <strong>Verified Agreement</strong>
            <code>\${proof.hash.slice(0, 16)}...</code>
          </div>
        </div>
      \`;
    }
  };
</script>`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Embed Compliance Match</h2>
        <p className="text-muted-foreground">
          Add verifiable trade agreements to your website with these code snippets.
        </p>
      </div>

      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Widget Preview
          </CardTitle>
          <CardDescription>
            How the compliance proof badge appears on your website
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Before State */}
            <div className="space-y-3">
              <Badge variant="outline">Before Recording</Badge>
              <div className="p-4 border rounded-lg bg-card">
                <h4 className="font-medium mb-2">Deal Confirmation</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  1,000 kg Hemp Biomass • €50,000
                </p>
                <Button size="sm">
                  <FileCheck className="h-4 w-4 mr-2" />
                  Record Agreement
                </Button>
              </div>
            </div>

            {/* After State */}
            <div className="space-y-3">
              <Badge variant="default" className="bg-green-600">After Recording</Badge>
              <div className="p-4 border rounded-lg bg-card">
                <h4 className="font-medium mb-2">Deal Confirmed</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  1,000 kg Hemp Biomass • €50,000
                </p>
                <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg text-white">
                  <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                    <Check className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="font-medium text-sm block">Verified Agreement</span>
                    <code className="text-xs opacity-90">a3b2c1d4e5f6789...</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Code Snippets */}
      <Card>
        <CardHeader>
          <CardTitle>Integration Code</CardTitle>
          <CardDescription>
            Copy these snippets to integrate Compliance Match into your website
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="react">
            <TabsList className="mb-4">
              <TabsTrigger value="react">React Component</TabsTrigger>
              <TabsTrigger value="backend">Backend API</TabsTrigger>
              <TabsTrigger value="html">HTML/JS</TabsTrigger>
              <TabsTrigger value="css">CSS Styles</TabsTrigger>
            </TabsList>

            <TabsContent value="react">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(reactWidgetCode, 'react')}
                >
                  {copiedSnippet === 'react' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm max-h-96">
                  <code>{reactWidgetCode}</code>
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="backend">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(backendCode, 'backend')}
                >
                  {copiedSnippet === 'backend' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm max-h-96">
                  <code>{backendCode}</code>
                </pre>
              </div>
              <p className="text-sm text-muted-foreground mt-3">
                <strong>Important:</strong> Store your API key as an environment variable. Never expose it in frontend code.
              </p>
            </TabsContent>

            <TabsContent value="html">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(htmlEmbedCode, 'html')}
                >
                  {copiedSnippet === 'html' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm max-h-96">
                  <code>{htmlEmbedCode}</code>
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="css">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(cssCode, 'css')}
                >
                  {copiedSnippet === 'css' ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-sm max-h-96">
                  <code>{cssCode}</code>
                </pre>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Integration Steps */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Start Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">1</span>
              <div>
                <strong>Create an API Key</strong>
                <p className="text-sm text-muted-foreground">Generate a key from your dashboard with <code>signals:write</code> scope</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">2</span>
              <div>
                <strong>Set up your backend</strong>
                <p className="text-sm text-muted-foreground">Create an API route that proxies requests to Trade.Izenzo (keeps your key secure)</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">3</span>
              <div>
                <strong>Add the widget</strong>
                <p className="text-sm text-muted-foreground">Copy the frontend component to your deal confirmation flow</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">4</span>
              <div>
                <strong>Display proof badges</strong>
                <p className="text-sm text-muted-foreground">Show the verification hash to users for transparency</p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmbeddableWidget;
