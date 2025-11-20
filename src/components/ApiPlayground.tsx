import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Play, Copy, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ApiPlayground() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [responseTime, setResponseTime] = useState<number | null>(null);
  const { toast } = useToast();

  // Signals state
  const [signalType, setSignalType] = useState<"buyer" | "seller">("buyer");
  const [signalWhat, setSignalWhat] = useState("Industrial fiber");
  const [signalHowMuch, setSignalHowMuch] = useState("10000");
  const [signalUnit, setSignalUnit] = useState("kg");
  const [signalWhere, setSignalWhere] = useState("Rotterdam");
  const [signalBudget, setSignalBudget] = useState("50000");
  const [signalCurrency, setSignalCurrency] = useState("USD");

  // Match state
  const [buyerId, setBuyerId] = useState("BUYER_001");
  const [buyerName, setBuyerName] = useState("Acme Corp");
  const [sellerId, setSellerId] = useState("SELLER_001");
  const [sellerName, setSellerName] = useState("Supply Co");
  const [commodity, setCommodity] = useState("Industrial fiber");
  const [quantityAmount, setQuantityAmount] = useState("1000");
  const [quantityUnit, setQuantityUnit] = useState("kg");
  const [priceAmount, setPriceAmount] = useState("50000");
  const [priceCurrency, setPriceCurrency] = useState("USD");
  const [terms, setTerms] = useState("Delivery within 30 days");

  // Webhook state
  const [webhookUrl, setWebhookUrl] = useState("https://your-domain.com/webhook");
  const [webhookEvents, setWebhookEvents] = useState("signal.created,match.created");
  const [webhookSecret, setWebhookSecret] = useState("your_webhook_secret");

  const baseUrl = "https://ugrfyhwlonlmlcmcpcdm.supabase.co/functions/v1";

  const copyResponse = () => {
    if (response) {
      navigator.clipboard.writeText(JSON.stringify(response, null, 2));
      toast({ title: "Copied!", description: "Response copied to clipboard" });
    }
  };

  const executeRequest = async (endpoint: string, method: string, body?: any) => {
    if (!apiKey) {
      toast({
        title: "API Key Required",
        description: "Please enter your API key to test endpoints",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setResponse(null);
    const startTime = Date.now();

    try {
      const options: RequestInit = {
        method,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
      };

      if (body) {
        options.body = JSON.stringify(body);
      }

      const res = await fetch(`${baseUrl}${endpoint}`, options);
      const data = await res.json();
      const endTime = Date.now();

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: Object.fromEntries(res.headers.entries()),
        body: data,
      });
      setResponseTime(endTime - startTime);

      if (!res.ok) {
        toast({
          title: "Request Failed",
          description: `${res.status}: ${data.error || res.statusText}`,
          variant: "destructive",
        });
      }
    } catch (error: any) {
      setResponse({
        status: 0,
        statusText: "Network Error",
        body: { error: error.message },
      });
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createSignal = () => {
    const body = {
      type: signalType,
      content: {
        what: signalWhat,
        how_much: parseInt(signalHowMuch),
        unit: signalUnit,
        where: signalWhere,
        when: "2024-Q1",
        budget: parseInt(signalBudget),
        currency: signalCurrency,
      },
    };
    executeRequest("/signals", "POST", body);
  };

  const createMatch = () => {
    const body = {
      buyer_id: buyerId,
      buyer_name: buyerName,
      seller_id: sellerId,
      seller_name: sellerName,
      commodity,
      quantity: {
        amount: parseInt(quantityAmount),
        unit: quantityUnit,
      },
      price: {
        amount: parseInt(priceAmount),
        currency: priceCurrency,
      },
      terms,
    };
    executeRequest("/match", "POST", body);
  };

  const createWebhook = () => {
    const body = {
      url: webhookUrl,
      events: webhookEvents.split(",").map((e) => e.trim()),
      secret: webhookSecret,
    };
    executeRequest("/webhooks", "POST", body);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Play className="h-5 w-5" />
            API Playground
          </CardTitle>
          <CardDescription>
            Test API endpoints with live requests and see responses in real-time
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* API Key Input */}
          <div className="space-y-2">
            <Label htmlFor="playground-api-key">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="playground-api-key"
                type="password"
                placeholder="Enter your API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono"
              />
              {apiKey && (
                <CheckCircle2 className="h-10 w-10 p-2 text-green-500 flex-shrink-0" />
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Your API key is only used locally and never stored
            </p>
          </div>

          <Tabs defaultValue="signals" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="signals">
                <Badge variant="default" className="mr-2 bg-green-600">POST</Badge>
                Signals
              </TabsTrigger>
              <TabsTrigger value="match">
                <Badge variant="default" className="mr-2 bg-green-600">POST</Badge>
                Match
              </TabsTrigger>
              <TabsTrigger value="webhooks">
                <Badge variant="default" className="mr-2 bg-green-600">POST</Badge>
                Webhooks
              </TabsTrigger>
            </TabsList>

            {/* Signals Endpoint */}
            <TabsContent value="signals" className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <code className="text-xs">POST /signals</code> - Create a signal and discover matching options
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={signalType} onValueChange={(v: "buyer" | "seller") => setSignalType(v)}>
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
                  <Input value={signalWhat} onChange={(e) => setSignalWhat(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={signalHowMuch} onChange={(e) => setSignalHowMuch(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input value={signalUnit} onChange={(e) => setSignalUnit(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Location</Label>
                  <Input value={signalWhere} onChange={(e) => setSignalWhere(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Budget</Label>
                  <Input type="number" value={signalBudget} onChange={(e) => setSignalBudget(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value={signalCurrency} onChange={(e) => setSignalCurrency(e.target.value)} />
                </div>
              </div>

              <Button onClick={createSignal} disabled={loading || !apiKey} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Execute Request
                  </>
                )}
              </Button>
            </TabsContent>

            {/* Match Endpoint */}
            <TabsContent value="match" className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <code className="text-xs">POST /match</code> - Record a trade match
                </AlertDescription>
              </Alert>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Buyer ID</Label>
                  <Input value={buyerId} onChange={(e) => setBuyerId(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Buyer Name</Label>
                  <Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Seller ID</Label>
                  <Input value={sellerId} onChange={(e) => setSellerId(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Seller Name</Label>
                  <Input value={sellerName} onChange={(e) => setSellerName(e.target.value)} />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label>Commodity</Label>
                  <Input value={commodity} onChange={(e) => setCommodity(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Quantity</Label>
                  <Input type="number" value={quantityAmount} onChange={(e) => setQuantityAmount(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input value={quantityUnit} onChange={(e) => setQuantityUnit(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Price</Label>
                  <Input type="number" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} />
                </div>

                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Input value={priceCurrency} onChange={(e) => setPriceCurrency(e.target.value)} />
                </div>

                <div className="space-y-2 col-span-2">
                  <Label>Terms</Label>
                  <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={2} />
                </div>
              </div>

              <Button onClick={createMatch} disabled={loading || !apiKey} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Execute Request
                  </>
                )}
              </Button>
            </TabsContent>

            {/* Webhooks Endpoint */}
            <TabsContent value="webhooks" className="space-y-4">
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <code className="text-xs">POST /webhooks</code> - Create a webhook endpoint
                </AlertDescription>
              </Alert>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Webhook URL</Label>
                  <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://your-domain.com/webhook" />
                </div>

                <div className="space-y-2">
                  <Label>Events (comma-separated)</Label>
                  <Input value={webhookEvents} onChange={(e) => setWebhookEvents(e.target.value)} placeholder="signal.created, match.created" />
                  <p className="text-xs text-muted-foreground">
                    Available: signal.created, option.selected, match.created, match.settled
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Secret</Label>
                  <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="your_webhook_secret" />
                  <p className="text-xs text-muted-foreground">
                    Used to verify webhook signatures
                  </p>
                </div>
              </div>

              <Button onClick={createWebhook} disabled={loading || !apiKey} className="w-full">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Request...
                  </>
                ) : (
                  <>
                    <Play className="mr-2 h-4 w-4" />
                    Execute Request
                  </>
                )}
              </Button>
            </TabsContent>
          </Tabs>

          {/* Response Section */}
          {response && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <h4 className="font-semibold">Response</h4>
                  {responseTime && (
                    <Badge variant="outline">{responseTime}ms</Badge>
                  )}
                  <Badge
                    variant={response.status >= 200 && response.status < 300 ? "default" : "destructive"}
                    className={response.status >= 200 && response.status < 300 ? "bg-green-600" : ""}
                  >
                    {response.status} {response.statusText}
                  </Badge>
                </div>
                <Button onClick={copyResponse} size="sm" variant="outline">
                  <Copy className="mr-2 h-4 w-4" />
                  Copy
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Response Body</Label>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs max-h-96 overflow-y-auto">
                  {JSON.stringify(response.body, null, 2)}
                </pre>
              </div>

              <div className="space-y-2">
                <Label>Response Headers</Label>
                <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-xs max-h-48 overflow-y-auto">
                  {JSON.stringify(response.headers, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
