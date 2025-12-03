import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Check, Shield, FileCheck, Download, Play, RotateCcw, Loader2, ArrowRight, Search, Package, Users } from "lucide-react";
import { toast } from "sonner";

const EmbeddableWidget = () => {
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  
  // Demo state
  const [demoStep, setDemoStep] = useState<1 | 2 | 3 | 4>(1);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoSignal, setDemoSignal] = useState<any>(null);
  const [demoOptions, setDemoOptions] = useState<any[]>([]);
  const [demoMatch, setDemoMatch] = useState<any>(null);
  
  const [demoData, setDemoData] = useState({
    type: "buyer" as "buyer" | "seller",
    commodity: "Hemp Biomass",
    quantity: "1000",
    unit: "kg",
    maxPrice: "55",
    currency: "EUR",
    location: "Amsterdam, NL",
  });

  const copyToClipboard = (code: string, snippetId: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSnippet(snippetId);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  // Step 1: Create Signal
  const createSignal = async () => {
    setDemoLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const signal = {
      id: crypto.randomUUID(),
      type: demoData.type,
      status: "active",
      content: {
        what: demoData.commodity,
        how_much: Number(demoData.quantity),
        unit: demoData.unit,
        where: demoData.location,
        max_price: demoData.type === "buyer" ? Number(demoData.maxPrice) : undefined,
        min_price: demoData.type === "seller" ? Number(demoData.maxPrice) : undefined,
        currency: demoData.currency,
      },
      created_at: new Date().toISOString(),
    };
    
    setDemoSignal(signal);
    setDemoLoading(false);
    setDemoStep(2);
    toast.success("Signal created! Now discovering matches...");
  };

  // Step 2: Discover Options
  const discoverOptions = async () => {
    setDemoLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const mockOptions = [
      {
        id: crypto.randomUUID(),
        what: demoData.commodity,
        how_much: Number(demoData.quantity) * 0.8,
        unit: demoData.unit,
        price: Number(demoData.maxPrice) * 0.95,
        currency: demoData.currency,
        where_location: "Rotterdam, NL",
        score: 0.92,
        source: "BioFarm Cooperative",
        freshness: "live",
      },
      {
        id: crypto.randomUUID(),
        what: demoData.commodity,
        how_much: Number(demoData.quantity),
        unit: demoData.unit,
        price: Number(demoData.maxPrice) * 1.02,
        currency: demoData.currency,
        where_location: "Berlin, DE",
        score: 0.87,
        source: "GreenFields GmbH",
        freshness: "cached",
      },
      {
        id: crypto.randomUUID(),
        what: demoData.commodity,
        how_much: Number(demoData.quantity) * 1.2,
        unit: demoData.unit,
        price: Number(demoData.maxPrice) * 0.98,
        currency: demoData.currency,
        where_location: "Brussels, BE",
        score: 0.85,
        source: "EuroHemp BVBA",
        freshness: "live",
      },
    ];
    
    setDemoOptions(mockOptions);
    setDemoLoading(false);
    setDemoStep(3);
    toast.success(`Found ${mockOptions.length} matching options!`);
  };

  // Step 3: Select Option
  const selectOption = async (option: any) => {
    setDemoLoading(true);
    await new Promise(resolve => setTimeout(resolve, 1200));
    
    const mockHash = Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    
    const match = {
      id: crypto.randomUUID(),
      hash: mockHash,
      status: "matched",
      buyer_name: demoData.type === "buyer" ? "Your Organization" : option.source,
      seller_name: demoData.type === "seller" ? "Your Organization" : option.source,
      commodity: option.what,
      quantity_amount: option.how_much,
      quantity_unit: option.unit,
      price_amount: option.price,
      price_currency: option.currency,
      created_at: new Date().toISOString(),
    };
    
    setDemoMatch(match);
    setDemoLoading(false);
    setDemoStep(4);
    toast.success("Match created with cryptographic proof!");
  };

  const resetDemo = () => {
    setDemoStep(1);
    setDemoSignal(null);
    setDemoOptions([]);
    setDemoMatch(null);
    setDemoData({
      type: "buyer",
      commodity: "Hemp Biomass",
      quantity: "1000",
      unit: "kg",
      maxPrice: "55",
      currency: "EUR",
      location: "Amsterdam, NL",
    });
  };

  // API Flow explanation
  const apiFlowSteps = [
    {
      step: 1,
      title: "Create Signal",
      endpoint: "POST /signals",
      description: "Submit buyer or seller intent (what you want to buy/sell)",
      icon: Package,
    },
    {
      step: 2,
      title: "Discover Options",
      endpoint: "GET /signals/{id}/options",
      description: "System finds matching counterparties automatically",
      icon: Search,
    },
    {
      step: 3,
      title: "Select & Match",
      endpoint: "POST /signals/{id}/select",
      description: "Choose an option to create a verified match",
      icon: Users,
    },
    {
      step: 4,
      title: "Get Proof",
      endpoint: "GET /match/{id}",
      description: "Retrieve cryptographic proof of the agreement",
      icon: Shield,
    },
  ];

  // Integration code templates
  const fullIntegrationCode = `// === Complete Integration Flow ===
// This shows how to search for matches and create verified agreements

const API_BASE = 'https://your-backend.com/api'; // Your backend proxy

// Step 1: Create a Signal (buyer or seller intent)
async function createSignal(signalData) {
  const response = await fetch(\`\${API_BASE}/signals\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: signalData.type, // 'buyer' or 'seller'
      content: {
        what: signalData.commodity,
        how_much: signalData.quantity,
        unit: signalData.unit,
        where: signalData.location,
        max_price: signalData.maxPrice, // for buyers
        min_price: signalData.minPrice, // for sellers
        currency: signalData.currency,
      }
    })
  });
  return response.json();
}

// Step 2: Discover matching options
async function discoverOptions(signalId) {
  const response = await fetch(\`\${API_BASE}/signals/\${signalId}/options\`);
  return response.json();
  // Returns array of matching options with scores
}

// Step 3: Select an option to create a match
async function selectOption(signalId, optionId) {
  const response = await fetch(\`\${API_BASE}/signals/\${signalId}/select\`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ option_id: optionId })
  });
  return response.json();
  // Returns match with cryptographic proof
}

// Step 4: Get match details/proof
async function getMatchProof(matchId) {
  const response = await fetch(\`\${API_BASE}/match/\${matchId}\`);
  return response.json();
}

// === Example Usage ===
async function findAndMatch() {
  // 1. Create buyer signal
  const signal = await createSignal({
    type: 'buyer',
    commodity: 'Hemp Biomass',
    quantity: 1000,
    unit: 'kg',
    location: 'Amsterdam, NL',
    maxPrice: 55,
    currency: 'EUR'
  });
  console.log('Signal created:', signal.id);

  // 2. Discover options
  const options = await discoverOptions(signal.id);
  console.log('Found options:', options.length);

  // 3. Select best option
  if (options.length > 0) {
    const bestOption = options[0]; // Highest scored
    const match = await selectOption(signal.id, bestOption.id);
    console.log('Match created:', match.hash);
  }
}`;

  const backendProxyCode = `// === Backend Proxy (keeps your API key secure) ===
// Node.js/Express example

const express = require('express');
const app = express();
app.use(express.json());

const COMPLIANCE_API = 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1';
const API_KEY = process.env.COMPLIANCE_MATCH_API_KEY;

// Proxy: Create Signal
app.post('/api/signals', async (req, res) => {
  const response = await fetch(\`\${COMPLIANCE_API}/signals\`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(req.body),
  });
  res.status(response.status).json(await response.json());
});

// Proxy: Get Options for Signal
app.get('/api/signals/:id/options', async (req, res) => {
  const response = await fetch(
    \`\${COMPLIANCE_API}/signals/\${req.params.id}/options\`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  res.status(response.status).json(await response.json());
});

// Proxy: Select Option
app.post('/api/signals/:id/select', async (req, res) => {
  const response = await fetch(
    \`\${COMPLIANCE_API}/signals/\${req.params.id}/select\`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    }
  );
  res.status(response.status).json(await response.json());
});

// Proxy: Get Match
app.get('/api/match/:id', async (req, res) => {
  const response = await fetch(
    \`\${COMPLIANCE_API}/match/\${req.params.id}\`,
    { headers: { 'X-API-Key': API_KEY } }
  );
  res.status(response.status).json(await response.json());
});

app.listen(3000);`;

  const reactHookCode = `// === React Hook for Full Integration ===
import { useState, useCallback } from 'react';

export function useComplianceMatch(apiBase = '/api') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Create a signal (buyer or seller intent)
  const createSignal = useCallback(async (data) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(\`\${apiBase}/signals\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create signal');
      return await res.json();
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // Get matching options for a signal
  const getOptions = useCallback(async (signalId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(\`\${apiBase}/signals/\${signalId}/options\`);
      if (!res.ok) throw new Error('Failed to get options');
      return await res.json();
    } catch (e) {
      setError(e.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // Select an option to create a match
  const selectOption = useCallback(async (signalId, optionId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(\`\${apiBase}/signals/\${signalId}/select\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ option_id: optionId }),
      });
      if (!res.ok) throw new Error('Failed to select option');
      return await res.json();
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  // Get match proof
  const getMatch = useCallback(async (matchId) => {
    setLoading(true);
    try {
      const res = await fetch(\`\${apiBase}/match/\${matchId}\`);
      return await res.json();
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  return { createSignal, getOptions, selectOption, getMatch, loading, error };
}

// === Example Component ===
function MatchFinder() {
  const { createSignal, getOptions, selectOption, loading, error } = useComplianceMatch();
  const [signal, setSignal] = useState(null);
  const [options, setOptions] = useState([]);
  const [match, setMatch] = useState(null);

  const handleSearch = async () => {
    // Step 1: Create signal
    const newSignal = await createSignal({
      type: 'buyer',
      content: {
        what: 'Hemp Biomass',
        how_much: 1000,
        unit: 'kg',
        where: 'Amsterdam',
        max_price: 55,
        currency: 'EUR'
      }
    });
    setSignal(newSignal);

    // Step 2: Get options
    if (newSignal) {
      const opts = await getOptions(newSignal.id);
      setOptions(opts);
    }
  };

  const handleSelect = async (optionId) => {
    // Step 3: Create match
    const newMatch = await selectOption(signal.id, optionId);
    setMatch(newMatch);
  };

  return (
    <div>
      {!signal && (
        <button onClick={handleSearch} disabled={loading}>
          {loading ? 'Searching...' : 'Find Matches'}
        </button>
      )}

      {options.length > 0 && !match && (
        <ul>
          {options.map(opt => (
            <li key={opt.id}>
              {opt.how_much} {opt.unit} @ {opt.currency} {opt.price}
              <button onClick={() => handleSelect(opt.id)}>Select</button>
            </li>
          ))}
        </ul>
      )}

      {match && (
        <div className="proof">
          ✓ Match Created: {match.hash.slice(0, 16)}...
        </div>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  );
}`;

  const downloadTemplate = (template: string, filename: string) => {
    const blob = new Blob([template], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${filename}`);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Integrate Compliance Match</h2>
        <p className="text-muted-foreground">
          Embed match discovery and verification into your platform.
        </p>
      </div>

      {/* API Flow Explanation */}
      <Card>
        <CardHeader>
          <CardTitle>How It Works</CardTitle>
          <CardDescription>
            The API uses a signal-based discovery system to find and verify matches
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {apiFlowSteps.map((step, index) => (
              <div key={step.step} className="relative">
                <div className={`p-4 rounded-lg border-2 ${demoStep === step.step ? 'border-primary bg-primary/5' : 'border-border'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${demoStep >= step.step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                      {step.step}
                    </div>
                    <step.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <h4 className="font-semibold text-sm">{step.title}</h4>
                  <code className="text-xs text-primary block my-1">{step.endpoint}</code>
                  <p className="text-xs text-muted-foreground">{step.description}</p>
                </div>
                {index < apiFlowSteps.length - 1 && (
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-3 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Interactive Demo */}
      <Card className="border-2 border-primary/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5 text-primary" />
                Interactive Demo
              </CardTitle>
              <CardDescription>
                Try the full flow: Signal → Options → Match → Proof
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={resetDemo}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Step 1: Create Signal */}
            {demoStep === 1 && (
              <div className="space-y-4 md:col-span-2">
                <Badge variant="outline">Step 1: Create Signal</Badge>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>I want to...</Label>
                      <Select value={demoData.type} onValueChange={(v: "buyer" | "seller") => setDemoData({ ...demoData, type: v })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="buyer">Buy (I'm looking for suppliers)</SelectItem>
                          <SelectItem value="seller">Sell (I have inventory)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Commodity</Label>
                      <Input
                        value={demoData.commodity}
                        onChange={(e) => setDemoData({ ...demoData, commodity: e.target.value })}
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          value={demoData.quantity}
                          onChange={(e) => setDemoData({ ...demoData, quantity: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Unit</Label>
                        <Input
                          value={demoData.unit}
                          onChange={(e) => setDemoData({ ...demoData, unit: e.target.value })}
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label>{demoData.type === "buyer" ? "Max Price" : "Min Price"}</Label>
                        <Input
                          type="number"
                          value={demoData.maxPrice}
                          onChange={(e) => setDemoData({ ...demoData, maxPrice: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Currency</Label>
                        <Input
                          value={demoData.currency}
                          onChange={(e) => setDemoData({ ...demoData, currency: e.target.value })}
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Location</Label>
                      <Input
                        value={demoData.location}
                        onChange={(e) => setDemoData({ ...demoData, location: e.target.value })}
                      />
                    </div>
                  </div>
                  
                  <div className="flex flex-col justify-between">
                    <div className="p-4 rounded-lg bg-muted/50 space-y-2">
                      <h4 className="font-medium text-sm">Your Signal Preview</h4>
                      <p className="text-sm text-muted-foreground">
                        <strong>Type:</strong> {demoData.type === "buyer" ? "Looking to buy" : "Looking to sell"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <strong>Item:</strong> {demoData.quantity} {demoData.unit} of {demoData.commodity}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <strong>{demoData.type === "buyer" ? "Max" : "Min"} Price:</strong> {demoData.currency} {demoData.maxPrice}/{demoData.unit}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        <strong>Location:</strong> {demoData.location}
                      </p>
                    </div>
                    
                    <Button onClick={createSignal} disabled={demoLoading} className="w-full mt-4">
                      {demoLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Creating Signal...
                        </>
                      ) : (
                        <>
                          <Search className="h-4 w-4 mr-2" />
                          Create Signal & Find Matches
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
            
            {/* Step 2: Discover Options */}
            {demoStep === 2 && (
              <div className="space-y-4 md:col-span-2">
                <Badge variant="outline">Step 2: Discovering Options...</Badge>
                <div className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-3">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <div>
                      <p className="font-medium">Signal Created: {demoSignal?.id.slice(0, 8)}...</p>
                      <p className="text-sm text-muted-foreground">Searching for matching {demoData.type === "buyer" ? "sellers" : "buyers"}...</p>
                    </div>
                  </div>
                </div>
                <Button onClick={discoverOptions} disabled={demoLoading}>
                  {demoLoading ? "Searching..." : "Discover Matching Options"}
                </Button>
              </div>
            )}
            
            {/* Step 3: Select Option */}
            {demoStep === 3 && (
              <div className="space-y-4 md:col-span-2">
                <Badge variant="outline">Step 3: Select an Option</Badge>
                <p className="text-sm text-muted-foreground">
                  Found {demoOptions.length} matching options. Select one to create a verified match:
                </p>
                <div className="grid gap-3">
                  {demoOptions.map((option, idx) => (
                    <div
                      key={option.id}
                      className="p-4 rounded-lg border hover:border-primary cursor-pointer transition-colors"
                      onClick={() => !demoLoading && selectOption(option)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{option.source}</span>
                            <Badge variant={option.freshness === "live" ? "default" : "secondary"} className="text-xs">
                              {option.freshness}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            {option.how_much} {option.unit} @ {option.currency} {option.price}/{option.unit} • {option.where_location}
                          </p>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-primary">{Math.round(option.score * 100)}%</div>
                          <div className="text-xs text-muted-foreground">match score</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                {demoLoading && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating match...
                  </div>
                )}
              </div>
            )}
            
            {/* Step 4: Match Proof */}
            {demoStep === 4 && demoMatch && (
              <div className="space-y-4 md:col-span-2">
                <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">
                  Step 4: Match Created
                </Badge>
                
                <div className="p-6 rounded-lg bg-gradient-to-br from-green-500/10 to-emerald-500/10 border border-green-500/20">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="h-6 w-6 text-white" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg">Verified Agreement</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Cryptographically sealed proof of transaction
                      </p>
                      
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Buyer:</span>
                          <span className="ml-2 font-medium">{demoMatch.buyer_name}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Seller:</span>
                          <span className="ml-2 font-medium">{demoMatch.seller_name}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Quantity:</span>
                          <span className="ml-2 font-medium">{demoMatch.quantity_amount} {demoMatch.quantity_unit}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Price:</span>
                          <span className="ml-2 font-medium">{demoMatch.price_currency} {demoMatch.price_amount}</span>
                        </div>
                      </div>
                      
                      <div className="mt-4 p-3 rounded bg-background/50">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-xs text-muted-foreground block">Proof Hash</span>
                            <code className="text-xs font-mono">{demoMatch.hash.slice(0, 32)}...</code>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              navigator.clipboard.writeText(demoMatch.hash);
                              toast.success("Hash copied!");
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Code Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Integration Code
          </CardTitle>
          <CardDescription>
            Copy-paste ready code for your platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="flow">
            <TabsList className="mb-4">
              <TabsTrigger value="flow">Full Flow</TabsTrigger>
              <TabsTrigger value="backend">Backend Proxy</TabsTrigger>
              <TabsTrigger value="react">React Hook</TabsTrigger>
            </TabsList>
            
            <TabsContent value="flow">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">Complete integration flow with all endpoints</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(fullIntegrationCode, 'flow')}>
                    {copiedSnippet === 'flow' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate(fullIntegrationCode, 'compliance-match-integration.js')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-96">
                <code>{fullIntegrationCode}</code>
              </pre>
            </TabsContent>
            
            <TabsContent value="backend">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">Node.js/Express backend proxy (keeps API key secure)</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(backendProxyCode, 'backend')}>
                    {copiedSnippet === 'backend' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate(backendProxyCode, 'backend-proxy.js')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-96">
                <code>{backendProxyCode}</code>
              </pre>
            </TabsContent>
            
            <TabsContent value="react">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm text-muted-foreground">React hook with example component</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => copyToClipboard(reactHookCode, 'react')}>
                    {copiedSnippet === 'react' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => downloadTemplate(reactHookCode, 'useComplianceMatch.tsx')}>
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-96">
                <code>{reactHookCode}</code>
              </pre>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Quick Start */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Start Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-4 text-sm">
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">1</span>
              <div>
                <strong>Get your API key</strong>
                <p className="text-muted-foreground">Navigate to API Keys section and create a new key with appropriate scopes.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">2</span>
              <div>
                <strong>Set up backend proxy</strong>
                <p className="text-muted-foreground">Never expose your API key in frontend code. Use the backend proxy template above.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">3</span>
              <div>
                <strong>Create signals</strong>
                <p className="text-muted-foreground">POST to /signals with buyer or seller intent to start discovering matches.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">4</span>
              <div>
                <strong>Display options to users</strong>
                <p className="text-muted-foreground">GET /signals/{'{id}'}/options returns matching counterparties with scores.</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">5</span>
              <div>
                <strong>Create verified match</strong>
                <p className="text-muted-foreground">POST to /signals/{'{id}'}/select with the chosen option to create a cryptographically sealed match.</p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmbeddableWidget;
