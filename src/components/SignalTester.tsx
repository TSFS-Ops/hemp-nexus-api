import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Send, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SignalTesterProps {
  apiKey: string | null;
}

export default function SignalTester({ apiKey }: SignalTesterProps) {
  const [loading, setLoading] = useState(false);
  const [signalId, setSignalId] = useState<string | null>(null);
  const [options, setOptions] = useState<any[]>([]);
  const [selectedOption, setSelectedOption] = useState<any | null>(null);
  const [testResult, setTestResult] = useState<any | null>(null);
  const { toast } = useToast();

  // Form state
  const [signalType, setSignalType] = useState<"buyer" | "seller">("buyer");
  const [product, setProduct] = useState("Hemp fibre");
  const [quantity, setQuantity] = useState("10000");
  const [unit, setUnit] = useState("kg");
  const [location, setLocation] = useState("Rotterdam");
  const [budget, setBudget] = useState("12000");
  const [currency, setCurrency] = useState("USD");

  const createSignal = async () => {
    if (!apiKey) {
      toast({ title: "Error", description: "Please create an API key first", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signals`, {
        method: "POST",
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product,
          quantity: parseFloat(quantity),
          unit,
          location,
          deliveryWindow: "2025-11-01",
          budget: parseFloat(budget),
          currency,
          notes: `${signalType} signal test`,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create signal");
      }

      const data = await response.json();
      setSignalId(data.signalId);
      
      toast({
        title: "Signal Created!",
        description: `Signal ID: ${data.signalId}. AI web search in progress (15-20s)...`,
      });

      // Wait 20 seconds for AI web search to complete
      setTimeout(() => {
        fetchOptions(data.signalId);
        toast({
          title: "Search Complete",
          description: "Fetching matched options...",
        });
      }, 20000);
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

  const fetchOptions = async (id?: string) => {
    const targetId = id || signalId;
    if (!targetId || !apiKey) return;

    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signals/${targetId}`,
        {
          headers: { "X-API-Key": apiKey },
        }
      );

      if (!response.ok) throw new Error("Failed to fetch options");

      const data = await response.json();
      setOptions(data.options || []);
      
      const optionCount = data.options?.length || 0;
      toast({
        title: optionCount > 0 ? "Options Found!" : "No Options Yet",
        description: optionCount > 0 
          ? `Found ${optionCount} matching options` 
          : "Search may still be running. Try refreshing in a few seconds.",
        variant: optionCount > 0 ? "default" : "destructive",
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

  const selectOption = async (optionId: string) => {
    if (!signalId || !apiKey) return;

    setLoading(true);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/signals/${signalId}/select`,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ option_id: optionId }),
        }
      );

      if (!response.ok) throw new Error("Failed to select option");

      const data = await response.json();
      setSelectedOption(data);
      
      toast({
        title: "Option Selected!",
        description: "Handoff token created",
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

  const testDiscoverEndpoint = async () => {
    if (!signalId || !apiKey) {
      toast({
        title: "Error",
        description: "Create a signal first",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setTestResult(null);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sr-discover`,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ signalId }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to call sr-discover");
      }

      const data = await response.json();
      setTestResult(data);
      
      toast({
        title: "sr-discover Test Successful!",
        description: `Found ${data.optionsCreated || 0} options via web search`,
      });
    } catch (error: any) {
      toast({
        title: "sr-discover Test Failed",
        description: error.message,
        variant: "destructive",
      });
      setTestResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!apiKey) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Test Signal Search</CardTitle>
          <CardDescription>Create an API key above to test the signal search</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Test Signal</CardTitle>
          <CardDescription>
            Test SAHPRA verification & global web search
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Signal Type</Label>
              <Select value={signalType} onValueChange={(v: any) => setSignalType(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="buyer">Buyer</SelectItem>
                  <SelectItem value="seller">Seller</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Product</Label>
              <Input value={product} onChange={(e) => setProduct(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Unit</Label>
              <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Total Budget</Label>
              <div className="grid grid-cols-2 gap-2">
                <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <Button onClick={createSignal} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Create Signal
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {signalId && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Test sr-discover Endpoint</CardTitle>
              <CardDescription>
                Verify API key authentication and web search integration
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button 
                onClick={testDiscoverEndpoint} 
                disabled={loading}
                variant="outline"
                className="w-full"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Test sr-discover Function
                  </>
                )}
              </Button>

              {testResult && (
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold">Test Result:</h4>
                  <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40">
                    {JSON.stringify(testResult, null, 2)}
                  </pre>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <div>
                  <CardTitle>Matched Options</CardTitle>
                  <CardDescription>Signal ID: {signalId}</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => fetchOptions()} disabled={loading}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
          <CardContent>
            {options.length === 0 ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-muted-foreground">
                  No options found yet.
                </p>
                <p className="text-sm text-muted-foreground">
                  AI web search takes 15-20 seconds. Click refresh above to check again.
                </p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => fetchOptions()}
                  disabled={loading}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Now
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {options.map((option) => (
                  <div key={option.id} className="border rounded-lg p-4 space-y-2">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">{option.what}</h3>
                        <p className="text-sm text-muted-foreground">
                          {option.how_much} {option.unit} • {option.where_location}
                        </p>
                        {option.price && (
                          <p className="text-sm font-medium">
                            {option.price} {option.currency}
                          </p>
                        )}
                        <div className="mt-2">
                          {option.quality_flags?.sahpra_verified ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                              ✓ SAHPRA Verified
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-100">
                              ⚠ No SAHPRA License
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-medium">Score: {option.score?.toFixed(2)}</div>
                        {option.confidence_score && (
                          <div className="text-xs text-muted-foreground">
                            Confidence: {(option.confidence_score * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {option.source_link && (
                      <a
                        href={option.source_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline block"
                      >
                        View Source →
                      </a>
                    )}

                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => selectOption(option.id)}
                      disabled={loading}
                    >
                      Select Option
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </>
      )}

      {selectedOption && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-green-600">Option Selected!</CardTitle>
            <CardDescription>Handoff details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <Label>Selection ID</Label>
              <p className="text-sm font-mono">{selectedOption.selection_id}</p>
            </div>
            <div>
              <Label>Handoff Token</Label>
              <p className="text-sm font-mono break-all">{selectedOption.handoff_token}</p>
            </div>
            {selectedOption.handoff_url && (
              <div>
                <Label>Handoff URL</Label>
                <a
                  href={selectedOption.handoff_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  {selectedOption.handoff_url}
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
