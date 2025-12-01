import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Copy, CheckCircle } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

interface MatchTesterProps {
  apiKey: string | null;
}

export default function MatchTester({ apiKey }: MatchTesterProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [matchId, setMatchId] = useState("");
  const [result, setResult] = useState<any>(null);

  // Create match form state
  const [buyerId, setBuyerId] = useState("BUYER_TEST_001");
  const [buyerName, setBuyerName] = useState("Test Buyer Ltd");
  const [sellerId, setSellerId] = useState("SELLER_TEST_001");
  const [sellerName, setSellerName] = useState("Test Seller Ltd");
  const [commodity, setCommodity] = useState("Industrial Fiber Material");
  const [quantityAmount, setQuantityAmount] = useState("1000");
  const [quantityUnit, setQuantityUnit] = useState("kg");
  const [priceAmount, setPriceAmount] = useState("50000");
  const [priceCurrency, setPriceCurrency] = useState("EUR");
  const [terms, setTerms] = useState("Delivery within 30 days, payment on delivery");
  const [metadata, setMetadata] = useState('{"region":"EU-Africa","channel":"Test Dashboard"}');
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied!", description: "Copied to clipboard" });
  };

  const handleCreateMatch = async () => {
    if (!apiKey) {
      toast({
        title: "No API Key",
        description: "Please create an API key first",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      let metadataObj = {};
      try {
        metadataObj = JSON.parse(metadata);
      } catch (e) {
        toast({
          title: "Invalid Metadata",
          description: "Metadata must be valid JSON",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const response = await fetch(`${BASE_URL}/match`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
          ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
        },
        body: JSON.stringify({
          buyer: { id: buyerId, name: buyerName },
          seller: { id: sellerId, name: sellerName },
          commodity,
          quantity: { amount: parseFloat(quantityAmount), unit: quantityUnit },
          price: { amount: parseFloat(priceAmount), currency: priceCurrency },
          terms,
          metadata: metadataObj,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to create match");
      }

      setResult(data);
      setMatchId(data.id);
      
      // Check for idempotency or duplicate headers
      const isIdempotentReplay = response.headers.get("X-Idempotent-Replay") === "true";
      const isHashDuplicate = response.headers.get("X-Match-Duplicate") === "true";
      
      toast({
        title: isIdempotentReplay ? "Match Returned (Idempotent)" : isHashDuplicate ? "Match Already Exists" : "Match Created!",
        description: isIdempotentReplay 
          ? `Returned cached match: ${data.id}` 
          : isHashDuplicate 
            ? `Hash collision detected. Existing match: ${data.id}`
            : `Match ID: ${data.id}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGetMatch = async () => {
    if (!apiKey) {
      toast({
        title: "No API Key",
        description: "Please create an API key first",
        variant: "destructive",
      });
      return;
    }

    if (!matchId) {
      toast({
        title: "No Match ID",
        description: "Please enter a match ID",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(`${BASE_URL}/match/${matchId}`, {
        headers: {
          "X-API-Key": apiKey,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to get match");
      }

      setResult(data);
      toast({
        title: "Match Retrieved",
        description: `Status: ${data.status}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSettleMatch = async () => {
    if (!apiKey) {
      toast({
        title: "No API Key",
        description: "Please create an API key first",
        variant: "destructive",
      });
      return;
    }

    if (!matchId) {
      toast({
        title: "No Match ID",
        description: "Please enter a match ID",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(`${BASE_URL}/match/${matchId}/settle`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to confirm intent");
      }

      setResult(data);
      toast({
        title: "Intent Confirmed!",
        description: `Confirmed at: ${new Date(data.settled_at).toLocaleString()}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleListMatches = async () => {
    if (!apiKey) {
      toast({
        title: "No API Key",
        description: "Please create an API key first",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await fetch(`${BASE_URL}/matches?limit=10`, {
        headers: {
          "X-API-Key": apiKey,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to list matches");
      }

      setResult(data);
      toast({
        title: "Matches Retrieved",
        description: `Found ${data.totalCount} total matches`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (!apiKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Match API Tester</CardTitle>
          <CardDescription>Create an API key above to test the match endpoints</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match API Tester</CardTitle>
        <CardDescription>Test the match recording and intent confirmation endpoints</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="create" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="create">Create</TabsTrigger>
            <TabsTrigger value="get">Get</TabsTrigger>
            <TabsTrigger value="confirm-intent">Confirm Intent</TabsTrigger>
            <TabsTrigger value="list">List</TabsTrigger>
          </TabsList>

          <TabsContent value="create" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="buyerId">Buyer ID</Label>
                <Input
                  id="buyerId"
                  value={buyerId}
                  onChange={(e) => setBuyerId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="buyerName">Buyer Name</Label>
                <Input
                  id="buyerName"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sellerId">Seller ID</Label>
                <Input
                  id="sellerId"
                  value={sellerId}
                  onChange={(e) => setSellerId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sellerName">Seller Name</Label>
                <Input
                  id="sellerName"
                  value={sellerName}
                  onChange={(e) => setSellerName(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="commodity">Commodity</Label>
              <Input
                id="commodity"
                value={commodity}
                onChange={(e) => setCommodity(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantityAmount">Quantity Amount</Label>
                <Input
                  id="quantityAmount"
                  type="number"
                  value={quantityAmount}
                  onChange={(e) => setQuantityAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quantityUnit">Unit</Label>
                <Input
                  id="quantityUnit"
                  value={quantityUnit}
                  onChange={(e) => setQuantityUnit(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="priceAmount">Price Amount</Label>
                <Input
                  id="priceAmount"
                  type="number"
                  value={priceAmount}
                  onChange={(e) => setPriceAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="priceCurrency">Currency</Label>
                <Input
                  id="priceCurrency"
                  value={priceCurrency}
                  onChange={(e) => setPriceCurrency(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="terms">Terms</Label>
              <Textarea
                id="terms"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="metadata">Metadata (JSON)</Label>
              <Textarea
                id="metadata"
                value={metadata}
                onChange={(e) => setMetadata(e.target.value)}
                rows={2}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="idempotencyKey">Idempotency Key (Optional)</Label>
              <Input
                id="idempotencyKey"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                placeholder="e.g., unique-request-123"
              />
              <p className="text-xs text-muted-foreground">
                Provide the same key to test idempotency. Duplicate requests will return cached results.
              </p>
            </div>

            <Button onClick={handleCreateMatch} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Match"
              )}
            </Button>
          </TabsContent>

          <TabsContent value="get" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="matchIdGet">Match ID</Label>
              <Input
                id="matchIdGet"
                placeholder="Enter match ID"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
              />
            </div>
            <Button onClick={handleGetMatch} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Retrieving...
                </>
              ) : (
                "Get Match"
              )}
            </Button>
          </TabsContent>

          <TabsContent value="confirm-intent" className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="matchIdConfirm">Match ID</Label>
              <Input
                id="matchIdConfirm"
                placeholder="Enter match ID"
                value={matchId}
                onChange={(e) => setMatchId(e.target.value)}
              />
            </div>
            <Button onClick={handleSettleMatch} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                "Confirm Intent"
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              This does not create any legal obligation. It only signals interest so the seller can prepare final terms.
            </p>
          </TabsContent>

          <TabsContent value="list" className="space-y-4">
            <p className="text-sm text-muted-foreground">
              List the 10 most recent matches
            </p>
            <Button onClick={handleListMatches} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading...
                </>
              ) : (
                "List Matches"
              )}
            </Button>
          </TabsContent>
        </Tabs>

        {result && (
          <div className="mt-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Result:</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copyToClipboard(JSON.stringify(result, null, 2))}
              >
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
            </div>

            {result.status && (
              <div className="flex items-center gap-2 text-sm">
                {result.status === "settled" ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-yellow-600" />
                )}
                <span className="font-medium">Status:</span>
                <span className="capitalize">{result.status}</span>
              </div>
            )}

            {result.hash && (
              <div className="space-y-1">
                <div className="text-sm font-medium">Cryptographic Proof Hash:</div>
                <div className="text-xs font-mono bg-muted p-2 rounded break-all">
                  {result.hash}
                </div>
              </div>
            )}

            <pre className="bg-muted p-4 rounded-lg overflow-auto text-xs">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}