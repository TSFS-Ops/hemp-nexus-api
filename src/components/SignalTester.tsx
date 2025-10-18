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
        description: `Signal ID: ${data.signalId}. Searching for matches...`,
      });

      // Wait 3 seconds for background search
      setTimeout(() => fetchOptions(data.signalId), 3000);
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
      
      toast({
        title: "Options Retrieved",
        description: `Found ${data.options?.length || 0} matching options`,
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
              <Label>Budget</Label>
              <Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>Currency</Label>
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
              <p className="text-muted-foreground text-center py-8">
                No options yet. Wait a moment and refresh...
              </p>
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
