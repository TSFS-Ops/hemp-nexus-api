import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, Shield, FileCheck, Download, Play, RotateCcw, Loader2 } from "lucide-react";
import { toast } from "sonner";

const EmbeddableWidget = () => {
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  
  // Demo state
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoProof, setDemoProof] = useState<{
    id: string;
    hash: string;
    status: string;
    created_at: string;
  } | null>(null);
  
  const [demoData, setDemoData] = useState({
    buyerName: "Acme Industries",
    sellerName: "BioFarm Cooperative",
    commodity: "Hemp Biomass",
    quantity: "1000",
    unit: "kg",
    price: "50000",
    currency: "EUR",
  });

  const copyToClipboard = (code: string, snippetId: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSnippet(snippetId);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const runDemo = async () => {
    setDemoLoading(true);
    setDemoProof(null);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Generate mock proof
    const mockHash = Array.from({ length: 64 }, () => 
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
    
    setDemoProof({
      id: crypto.randomUUID(),
      hash: mockHash,
      status: "matched",
      created_at: new Date().toISOString(),
    });
    
    setDemoLoading(false);
    toast.success("Demo match recorded successfully!");
  };

  const resetDemo = () => {
    setDemoProof(null);
    setDemoData({
      buyerName: "Acme Industries",
      sellerName: "BioFarm Cooperative",
      commodity: "Hemp Biomass",
      quantity: "1000",
      unit: "kg",
      price: "50000",
      currency: "EUR",
    });
  };

  // Starter Templates
  const reactTemplate = `// === Trade.Izenzo React Integration ===
// Install: npm install

import React, { useState, useCallback } from 'react';

// Types
interface MatchProof {
  id: string;
  hash: string;
  status: string;
  created_at: string;
  buyer_name: string;
  seller_name: string;
  commodity: string;
  quantity_amount: number;
  quantity_unit: string;
  price_amount: number;
  price_currency: string;
}

interface DealData {
  buyer: { id: string; name: string };
  seller: { id: string; name: string };
  commodity: string;
  quantity: { amount: number; unit: string };
  price: { amount: number; currency: string };
  terms?: string;
  metadata?: Record<string, any>;
}

// Hook for Trade.Izenzo integration
export function useComplianceMatch(apiEndpoint: string) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordMatch = useCallback(async (deal: DealData): Promise<MatchProof | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deal)
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to record match');
      }
      
      return await response.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  const getMatch = useCallback(async (matchId: string): Promise<MatchProof | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(\`\${apiEndpoint}/\${matchId}\`);
      if (!response.ok) throw new Error('Match not found');
      return await response.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  return { recordMatch, getMatch, loading, error };
}

// Proof Badge Component
export function ProofBadge({ proof }: { proof: MatchProof }) {
  const [copied, setCopied] = useState(false);

  const copyHash = () => {
    navigator.clipboard.writeText(proof.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="proof-badge" onClick={copyHash} style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '16px',
      background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
      borderRadius: '8px',
      color: 'white',
      cursor: 'pointer',
      transition: 'transform 0.2s',
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        background: 'rgba(255,255,255,0.2)',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
      }}>
        ✓
      </div>
      <div>
        <strong style={{ display: 'block', fontSize: '14px' }}>
          Verified Agreement
        </strong>
        <code style={{ fontSize: '12px', opacity: 0.9, fontFamily: 'monospace' }}>
          {copied ? 'Copied!' : \`\${proof.hash.slice(0, 16)}...\`}
        </code>
      </div>
    </div>
  );
}

// Main Widget Component
export function ComplianceMatchWidget({ 
  apiEndpoint = '/api/record-match',
  onMatchCreated,
  deal 
}: { 
  apiEndpoint?: string;
  onMatchCreated?: (proof: MatchProof) => void;
  deal: DealData;
}) {
  const { recordMatch, loading, error } = useComplianceMatch(apiEndpoint);
  const [proof, setProof] = useState<MatchProof | null>(null);

  const handleRecord = async () => {
    const result = await recordMatch(deal);
    if (result) {
      setProof(result);
      onMatchCreated?.(result);
    }
  };

  if (proof) {
    return <ProofBadge proof={proof} />;
  }

  return (
    <div>
      {error && (
        <div style={{ color: '#ef4444', marginBottom: '8px', fontSize: '14px' }}>
          {error}
        </div>
      )}
      <button
        onClick={handleRecord}
        disabled={loading}
        style={{
          padding: '12px 24px',
          background: '#3b82f6',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        {loading ? 'Recording...' : 'Record Agreement'}
      </button>
    </div>
  );
}

// Example Usage
export default function ExamplePage() {
  const deal = {
    buyer: { id: 'BUYER001', name: 'Acme Industries' },
    seller: { id: 'SELLER001', name: 'BioFarm Cooperative' },
    commodity: 'Hemp Biomass',
    quantity: { amount: 1000, unit: 'kg' },
    price: { amount: 50000, currency: 'EUR' },
    terms: 'Delivery within 30 days',
  };

  return (
    <div style={{ padding: '24px' }}>
      <h2>Deal Confirmation</h2>
      <p>1,000 kg Hemp Biomass • €50,000</p>
      <ComplianceMatchWidget 
        deal={deal}
        onMatchCreated={(proof) => console.log('Match created:', proof)}
      />
    </div>
  );
}`;

  const nextjsTemplate = `// === Trade.Izenzo Next.js Integration ===

// --- 1. API Route: app/api/record-match/route.ts ---
import { NextRequest, NextResponse } from 'next/server';

const TRADE_IZENZO_API = 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(TRADE_IZENZO_API, {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.TRADE_IZENZO_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    
    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Trade.Izenzo API error:', error);
    return NextResponse.json(
      { error: 'Failed to record match' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const matchId = searchParams.get('id');
  
  if (!matchId) {
    return NextResponse.json({ error: 'Match ID required' }, { status: 400 });
  }

  try {
    const response = await fetch(\`\${TRADE_IZENZO_API}/\${matchId}\`, {
      headers: {
        'X-API-Key': process.env.TRADE_IZENZO_API_KEY!,
      },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch match' }, { status: 500 });
  }
}

// --- 2. Hook: hooks/useComplianceMatch.ts ---
'use client';

import { useState, useCallback } from 'react';

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

export function useComplianceMatch() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordMatch = useCallback(async (deal: DealData) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/record-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(deal),
      });
      
      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to record match');
      }
      
      return await response.json();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { recordMatch, loading, error };
}

// --- 3. Component: components/ComplianceWidget.tsx ---
'use client';

import { useState } from 'react';
import { useComplianceMatch } from '@/hooks/useComplianceMatch';

export function ComplianceWidget({ deal, onSuccess }: { 
  deal: DealData; 
  onSuccess?: (proof: MatchProof) => void;
}) {
  const { recordMatch, loading, error } = useComplianceMatch();
  const [proof, setProof] = useState<MatchProof | null>(null);

  const handleRecord = async () => {
    const result = await recordMatch(deal);
    if (result) {
      setProof(result);
      onSuccess?.(result);
    }
  };

  if (proof) {
    return (
      <div className="flex items-center gap-3 p-4 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg text-white">
        <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
          ✓
        </div>
        <div>
          <strong className="block text-sm">Verified Agreement</strong>
          <code className="text-xs opacity-90">{proof.hash.slice(0, 16)}...</code>
        </div>
      </div>
    );
  }

  return (
    <div>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <button
        onClick={handleRecord}
        disabled={loading}
        className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Recording...' : 'Record Agreement'}
      </button>
    </div>
  );
}

// --- 4. Environment: .env.local ---
// TRADE_IZENZO_API_KEY=sk_your_api_key_here

// --- 5. Usage: app/deal/[id]/page.tsx ---
import { ComplianceWidget } from '@/components/ComplianceWidget';

export default function DealPage() {
  const deal = {
    buyer: { id: 'BUYER001', name: 'Acme Industries' },
    seller: { id: 'SELLER001', name: 'BioFarm Co' },
    commodity: 'Hemp Biomass',
    quantity: { amount: 1000, unit: 'kg' },
    price: { amount: 50000, currency: 'EUR' },
  };

  return (
    <main className="p-8">
      <h1 className="text-2xl font-bold mb-4">Deal Confirmation</h1>
      <ComplianceWidget deal={deal} />
    </main>
  );
}`;

  const vanillaTemplate = `<!-- === Trade.Izenzo Vanilla JavaScript Integration === -->

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Trade.Izenzo Integration</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; padding: 24px; background: #f5f5f5; }
    
    .deal-card {
      max-width: 400px;
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
    }
    
    .deal-card h2 { margin-bottom: 8px; color: #1a1a1a; }
    .deal-card .details { color: #666; margin-bottom: 16px; }
    
    .record-btn {
      width: 100%;
      padding: 12px 24px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
      transition: background 0.2s;
    }
    .record-btn:hover { background: #2563eb; }
    .record-btn:disabled { opacity: 0.7; cursor: not-allowed; }
    
    .proof-badge {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      border-radius: 8px;
      color: white;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .proof-badge:hover { transform: scale(1.02); }
    
    .proof-icon {
      width: 32px;
      height: 32px;
      background: rgba(255,255,255,0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    
    .proof-badge strong { display: block; font-size: 14px; margin-bottom: 2px; }
    .proof-badge code { font-size: 12px; opacity: 0.9; font-family: monospace; }
    
    .error { color: #ef4444; font-size: 14px; margin-bottom: 12px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <div class="deal-card" id="dealCard">
    <h2>Deal Confirmation</h2>
    <p class="details" id="dealDetails">Loading...</p>
    
    <div id="errorMessage" class="error hidden"></div>
    
    <div id="recordSection">
      <button class="record-btn" id="recordBtn" onclick="recordMatch()">
        Record Agreement
      </button>
    </div>
    
    <div id="proofSection" class="hidden">
      <div class="proof-badge" onclick="copyHash()">
        <div class="proof-icon">✓</div>
        <div>
          <strong>Verified Agreement</strong>
          <code id="proofHash">...</code>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Configuration - Change this to your backend endpoint
    const API_ENDPOINT = '/api/record-match';
    
    // Sample deal data - Replace with your actual data
    const deal = {
      buyer: { id: 'BUYER001', name: 'Acme Industries' },
      seller: { id: 'SELLER001', name: 'BioFarm Cooperative' },
      commodity: 'Hemp Biomass',
      quantity: { amount: 1000, unit: 'kg' },
      price: { amount: 50000, currency: 'EUR' },
      terms: 'Delivery within 30 days',
    };
    
    let currentProof = null;
    
    // Initialize
    document.addEventListener('DOMContentLoaded', () => {
      document.getElementById('dealDetails').textContent = 
        \`\${deal.quantity.amount} \${deal.quantity.unit} \${deal.commodity} • \${deal.price.currency} \${deal.price.amount.toLocaleString()}\`;
    });
    
    // Record match
    async function recordMatch() {
      const btn = document.getElementById('recordBtn');
      const errorEl = document.getElementById('errorMessage');
      
      btn.disabled = true;
      btn.textContent = 'Recording...';
      errorEl.classList.add('hidden');
      
      try {
        const response = await fetch(API_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(deal),
        });
        
        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.message || 'Failed to record match');
        }
        
        currentProof = await response.json();
        showProof(currentProof);
        
      } catch (error) {
        errorEl.textContent = error.message;
        errorEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Record Agreement';
      }
    }
    
    // Show proof badge
    function showProof(proof) {
      document.getElementById('recordSection').classList.add('hidden');
      document.getElementById('proofSection').classList.remove('hidden');
      document.getElementById('proofHash').textContent = proof.hash.slice(0, 16) + '...';
    }
    
    // Copy hash to clipboard
    function copyHash() {
      if (currentProof) {
        navigator.clipboard.writeText(currentProof.hash);
        document.getElementById('proofHash').textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('proofHash').textContent = currentProof.hash.slice(0, 16) + '...';
        }, 2000);
      }
    }
  </script>
</body>
</html>

<!-- 
=== Backend API Route (Node.js/Express) ===

const express = require('express');
const app = express();
app.use(express.json());

const TRADE_IZENZO_API = 'https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1/match';

app.post('/api/record-match', async (req, res) => {
  try {
    const response = await fetch(TRADE_IZENZO_API, {
      method: 'POST',
      headers: {
        'X-API-Key': process.env.TRADE_IZENZO_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });
    
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to record match' });
  }
});

app.listen(3000);
-->`;

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
        <h2 className="text-2xl font-bold mb-2">Embed Compliance Match</h2>
        <p className="text-muted-foreground">
          Add verifiable trade agreements to your website with ready-to-use templates.
        </p>
      </div>

      {/* Interactive Demo */}
      <Card className="border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5 text-primary" />
            Interactive Demo
          </CardTitle>
          <CardDescription>
            Test the widget with sample data before embedding
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-6">
            {/* Input Form */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="buyerName">Buyer Name</Label>
                  <Input
                    id="buyerName"
                    value={demoData.buyerName}
                    onChange={(e) => setDemoData({ ...demoData, buyerName: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sellerName">Seller Name</Label>
                  <Input
                    id="sellerName"
                    value={demoData.sellerName}
                    onChange={(e) => setDemoData({ ...demoData, sellerName: e.target.value })}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="commodity">Commodity</Label>
                <Input
                  id="commodity"
                  value={demoData.commodity}
                  onChange={(e) => setDemoData({ ...demoData, commodity: e.target.value })}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    value={demoData.quantity}
                    onChange={(e) => setDemoData({ ...demoData, quantity: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="unit">Unit</Label>
                  <Input
                    id="unit"
                    value={demoData.unit}
                    onChange={(e) => setDemoData({ ...demoData, unit: e.target.value })}
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="price">Price</Label>
                  <Input
                    id="price"
                    type="number"
                    value={demoData.price}
                    onChange={(e) => setDemoData({ ...demoData, price: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Currency</Label>
                  <Input
                    id="currency"
                    value={demoData.currency}
                    onChange={(e) => setDemoData({ ...demoData, currency: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Live Preview */}
            <div className="space-y-4">
              <div className="p-4 border rounded-lg bg-card min-h-[200px]">
                <h4 className="font-medium mb-2">Deal Confirmation</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  {demoData.quantity} {demoData.unit} {demoData.commodity} • {demoData.currency} {Number(demoData.price).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  {demoData.buyerName} ↔ {demoData.sellerName}
                </p>
                
                {demoProof ? (
                  <div 
                    className="flex items-center gap-3 p-3 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg text-white cursor-pointer hover:scale-[1.02] transition-transform"
                    onClick={() => {
                      navigator.clipboard.writeText(demoProof.hash);
                      toast.success("Hash copied to clipboard");
                    }}
                  >
                    <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
                      <Check className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="font-medium text-sm block">Verified Agreement</span>
                      <code className="text-xs opacity-90">{demoProof.hash.slice(0, 20)}...</code>
                    </div>
                  </div>
                ) : (
                  <Button onClick={runDemo} disabled={demoLoading} className="w-full">
                    {demoLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Recording...
                      </>
                    ) : (
                      <>
                        <FileCheck className="h-4 w-4 mr-2" />
                        Record Agreement
                      </>
                    )}
                  </Button>
                )}
              </div>
              
              {demoProof && (
                <Button variant="outline" onClick={resetDemo} className="w-full">
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset Demo
                </Button>
              )}
              
              <p className="text-xs text-muted-foreground text-center">
                This is a demo simulation. No actual API calls are made.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Downloadable Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            Starter Templates
          </CardTitle>
          <CardDescription>
            Download ready-to-use integration templates for your stack
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z"/>
                  </svg>
                  React
                </CardTitle>
                <CardDescription className="text-xs">
                  Hook + Component + Types
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => downloadTemplate(reactTemplate, 'trade-izenzo-react.tsx')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.572 0c-.176 0-.31.001-.358.007a19.76 19.76 0 0 1-.364.033C7.443.346 4.25 2.185 2.228 5.012a11.875 11.875 0 0 0-2.119 5.243c-.096.659-.108.854-.108 1.747s.012 1.089.108 1.748c.652 4.506 3.86 8.292 8.209 9.695.779.25 1.6.422 2.534.525.363.04 1.935.04 2.299 0 1.611-.178 2.977-.577 4.323-1.264.207-.106.247-.134.219-.158-.02-.013-.9-1.193-1.955-2.62l-1.919-2.592-2.404-3.558a338.739 338.739 0 0 0-2.422-3.556c-.009-.002-.018 1.579-.023 3.51-.007 3.38-.01 3.515-.052 3.595a.426.426 0 0 1-.206.214c-.075.037-.14.044-.495.044H7.81l-.108-.068a.438.438 0 0 1-.157-.171l-.05-.106.006-4.703.007-4.705.072-.092a.645.645 0 0 1 .174-.143c.096-.047.134-.051.54-.051.478 0 .558.018.682.154.035.038 1.337 1.999 2.895 4.361a10760.433 10760.433 0 0 0 4.735 7.17l1.9 2.879.096-.063a12.317 12.317 0 0 0 2.466-2.163 11.944 11.944 0 0 0 2.824-6.134c.096-.66.108-.854.108-1.748 0-.893-.012-1.088-.108-1.747-.652-4.506-3.859-8.292-8.208-9.695a12.597 12.597 0 0 0-2.499-.523A33.119 33.119 0 0 0 11.573 0zm4.069 7.217c.347 0 .408.005.486.047a.473.473 0 0 1 .237.277c.018.06.023 1.365.018 4.304l-.006 4.218-.744-1.14-.746-1.14v-3.066c0-1.982.01-3.097.023-3.15a.478.478 0 0 1 .233-.296c.096-.05.13-.054.5-.054z"/>
                  </svg>
                  Next.js
                </CardTitle>
                <CardDescription className="text-xs">
                  API Route + Hook + Component
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => downloadTemplate(nextjsTemplate, 'trade-izenzo-nextjs.ts')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </CardContent>
            </Card>

            <Card className="border-2 hover:border-primary/50 transition-colors">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M0 0h24v24H0V0zm22.034 18.276c-.175-1.095-.888-2.015-3.003-2.873-.736-.345-1.554-.585-1.797-1.14-.091-.33-.105-.51-.046-.705.15-.646.915-.84 1.515-.66.39.12.75.42.976.9 1.034-.676 1.034-.676 1.755-1.125-.27-.42-.404-.601-.586-.78-.63-.705-1.469-1.065-2.834-1.034l-.705.089c-.676.165-1.32.525-1.71 1.005-1.14 1.291-.811 3.541.569 4.471 1.365 1.02 3.361 1.244 3.616 2.205.24 1.17-.87 1.545-1.966 1.41-.811-.18-1.26-.586-1.755-1.336l-1.83 1.051c.21.48.45.689.81 1.109 1.74 1.756 6.09 1.666 6.871-1.004.029-.09.24-.705.074-1.65l.046.067zm-8.983-7.245h-2.248c0 1.938-.009 3.864-.009 5.805 0 1.232.063 2.363-.138 2.711-.33.689-1.18.601-1.566.48-.396-.196-.597-.466-.83-.855-.063-.105-.11-.196-.127-.196l-1.825 1.125c.305.63.75 1.172 1.324 1.517.855.51 2.004.675 3.207.405.783-.226 1.458-.691 1.811-1.411.51-.93.402-2.07.397-3.346.012-2.054 0-4.109 0-6.179l.004-.056z"/>
                  </svg>
                  Vanilla JS
                </CardTitle>
                <CardDescription className="text-xs">
                  HTML + CSS + JavaScript
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={() => downloadTemplate(vanillaTemplate, 'trade-izenzo-vanilla.html')}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      {/* Code Preview Tabs */}
      <Card>
        <CardHeader>
          <CardTitle>Template Code Preview</CardTitle>
          <CardDescription>
            View the full source code before downloading
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="react">
            <TabsList className="mb-4">
              <TabsTrigger value="react">React</TabsTrigger>
              <TabsTrigger value="nextjs">Next.js</TabsTrigger>
              <TabsTrigger value="vanilla">Vanilla JS</TabsTrigger>
            </TabsList>

            <TabsContent value="react">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(reactTemplate, 'react')}
                >
                  {copiedSnippet === 'react' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-96">
                  <code>{reactTemplate}</code>
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="nextjs">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(nextjsTemplate, 'nextjs')}
                >
                  {copiedSnippet === 'nextjs' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-96">
                  <code>{nextjsTemplate}</code>
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="vanilla">
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 z-10"
                  onClick={() => copyToClipboard(vanillaTemplate, 'vanilla')}
                >
                  {copiedSnippet === 'vanilla' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
                <pre className="p-4 bg-muted rounded-lg overflow-x-auto text-xs max-h-96">
                  <code>{vanillaTemplate}</code>
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
                <p className="text-sm text-muted-foreground">Generate a key from your dashboard with <code className="bg-muted px-1 rounded">signals:write</code> scope</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">2</span>
              <div>
                <strong>Download a template</strong>
                <p className="text-sm text-muted-foreground">Choose React, Next.js, or Vanilla JS based on your stack</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">3</span>
              <div>
                <strong>Configure your backend</strong>
                <p className="text-sm text-muted-foreground">Add your API key as an environment variable (never expose in frontend)</p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-primary text-primary-foreground rounded-full flex items-center justify-center text-sm font-medium">4</span>
              <div>
                <strong>Customize & deploy</strong>
                <p className="text-sm text-muted-foreground">Style the widget to match your brand and integrate into your deal flow</p>
              </div>
            </li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmbeddableWidget;
