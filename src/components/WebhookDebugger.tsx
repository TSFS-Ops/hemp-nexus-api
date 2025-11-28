import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Clock,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Eye,
  Copy,
  Play,
  AlertCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { format } from "date-fns";

interface WebhookDelivery {
  id: string;
  webhook_endpoint_id: string;
  event_type: string;
  payload: any;
  response_status_code: number | null;
  response_body: string | null;
  error_message: string | null;
  delivery_attempt: number;
  max_retries: number | null;
  is_dead_letter: boolean | null;
  next_retry_at: string | null;
  created_at: string;
  delivered_at: string;
}

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: string;
}

export default function WebhookDebugger() {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDelivery, setSelectedDelivery] = useState<WebhookDelivery | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [endpointFilter, setEndpointFilter] = useState<string>("all");
  const [replaying, setReplaying] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["payload"]));

  useEffect(() => {
    fetchData();
    
    // Set up realtime subscription for webhook deliveries
    const channel = supabase
      .channel("webhook-deliveries-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "webhook_deliveries",
        },
        () => {
          fetchData();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [deliveriesRes, endpointsRes] = await Promise.all([
        supabase
          .from("webhook_deliveries")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("webhook_endpoints")
          .select("*")
          .eq("status", "active"),
      ]);

      if (deliveriesRes.data) setDeliveries(deliveriesRes.data);
      if (endpointsRes.data) setEndpoints(endpointsRes.data);
    } catch (error) {
      console.error("Error fetching webhook data:", error);
      toast.error("Failed to load webhook data");
    } finally {
      setLoading(false);
    }
  };

  const handleReplay = async (delivery: WebhookDelivery) => {
    setReplaying(delivery.id);
    try {
      const endpoint = endpoints.find((e) => e.id === delivery.webhook_endpoint_id);
      if (!endpoint) {
        toast.error("Webhook endpoint not found");
        return;
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/webhooks`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({
            endpoint_id: endpoint.id,
            event_type: delivery.event_type,
            payload: delivery.payload,
            replay: true,
          }),
        }
      );

      if (response.ok) {
        toast.success("Webhook replayed successfully");
        await fetchData();
      } else {
        const error = await response.json();
        toast.error(`Replay failed: ${error.message || "Unknown error"}`);
      }
    } catch (error) {
      console.error("Error replaying webhook:", error);
      toast.error("Failed to replay webhook");
    } finally {
      setReplaying(null);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied to clipboard`);
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const getStatusBadge = (delivery: WebhookDelivery) => {
    if (delivery.is_dead_letter) {
      return <Badge variant="destructive">Dead Letter</Badge>;
    }
    if (delivery.response_status_code && delivery.response_status_code >= 200 && delivery.response_status_code < 300) {
      return <Badge className="bg-green-500">Success</Badge>;
    }
    if (delivery.delivery_attempt < (delivery.max_retries || 3)) {
      return <Badge variant="secondary">Retrying</Badge>;
    }
    return <Badge variant="destructive">Failed</Badge>;
  };

  const getTimelineSteps = (delivery: WebhookDelivery) => {
    const steps: Array<{
      label: string;
      time: string;
      status: "complete" | "failed" | "pending";
      icon: any;
    }> = [
      {
        label: "Created",
        time: delivery.created_at,
        status: "complete",
        icon: CheckCircle2,
      },
    ];

    if (delivery.delivery_attempt > 1) {
      for (let i = 1; i < delivery.delivery_attempt; i++) {
        steps.push({
          label: `Retry ${i}`,
          time: delivery.created_at,
          status: "failed",
          icon: XCircle,
        });
      }
    }

    if (delivery.response_status_code) {
      steps.push({
        label: delivery.response_status_code >= 200 && delivery.response_status_code < 300 ? "Delivered" : "Failed",
        time: delivery.delivered_at,
        status: delivery.response_status_code >= 200 && delivery.response_status_code < 300 ? "complete" : "failed",
        icon: delivery.response_status_code >= 200 && delivery.response_status_code < 300 ? CheckCircle2 : XCircle,
      });
    }

    if (delivery.next_retry_at && !delivery.is_dead_letter) {
      steps.push({
        label: "Next Retry",
        time: delivery.next_retry_at,
        status: "pending",
        icon: Clock,
      });
    }

    return steps;
  };

  const filteredDeliveries = deliveries.filter((delivery) => {
    const matchesSearch =
      searchQuery === "" ||
      delivery.event_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      delivery.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "success" && delivery.response_status_code && delivery.response_status_code >= 200 && delivery.response_status_code < 300) ||
      (statusFilter === "failed" && delivery.error_message) ||
      (statusFilter === "retrying" && delivery.delivery_attempt < (delivery.max_retries || 3)) ||
      (statusFilter === "dead_letter" && delivery.is_dead_letter);

    const matchesEndpoint =
      endpointFilter === "all" || delivery.webhook_endpoint_id === endpointFilter;

    return matchesSearch && matchesStatus && matchesEndpoint;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Webhook Debugger</CardTitle>
          <CardDescription>
            Inspect, replay, and debug webhook deliveries
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by event or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="retrying">Retrying</SelectItem>
                <SelectItem value="dead_letter">Dead Letter</SelectItem>
              </SelectContent>
            </Select>
            <Select value={endpointFilter} onValueChange={setEndpointFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by endpoint" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Endpoints</SelectItem>
                {endpoints.map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {new URL(endpoint.url).hostname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={fetchData} variant="outline" className="w-full">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </CardContent>
      </Card>

      {/* Deliveries List & Details */}
      <div className="grid gap-6 md:grid-cols-5">
        {/* List */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Deliveries ({filteredDeliveries.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {filteredDeliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  onClick={() => setSelectedDelivery(delivery)}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors hover:bg-muted/50 ${
                    selectedDelivery?.id === delivery.id ? "bg-muted border-primary" : ""
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{delivery.event_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(delivery.created_at), "MMM d, HH:mm:ss")}
                      </p>
                    </div>
                    {getStatusBadge(delivery)}
                  </div>
                  {delivery.error_message && (
                    <Alert variant="destructive" className="mt-2">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription className="text-xs">
                        {delivery.error_message.substring(0, 50)}...
                      </AlertDescription>
                    </Alert>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline" className="text-xs">
                      Attempt {delivery.delivery_attempt}/{delivery.max_retries || 3}
                    </Badge>
                    {delivery.response_status_code && (
                      <Badge variant="outline" className="text-xs">
                        {delivery.response_status_code}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
              {filteredDeliveries.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No webhook deliveries found
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card className="md:col-span-3">
          <CardHeader>
            <CardTitle>Delivery Details</CardTitle>
            {selectedDelivery && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleReplay(selectedDelivery)}
                  disabled={replaying === selectedDelivery.id}
                >
                  {replaying === selectedDelivery.id ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Replaying...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Replay
                    </>
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    copyToClipboard(JSON.stringify(selectedDelivery.payload, null, 2), "Payload")
                  }
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Payload
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {selectedDelivery ? (
              <Tabs defaultValue="payload" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="payload">Payload</TabsTrigger>
                  <TabsTrigger value="response">Response</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                </TabsList>

                <TabsContent value="payload" className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">Event Type</h4>
                      <Badge>{selectedDelivery.event_type}</Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">Delivery ID</h4>
                      <code className="text-xs bg-muted px-2 py-1 rounded">
                        {selectedDelivery.id}
                      </code>
                    </div>
                  </div>

                  <div>
                    <div
                      className="flex items-center justify-between cursor-pointer mb-2"
                      onClick={() => toggleSection("payload")}
                    >
                      <h4 className="font-semibold">Payload JSON</h4>
                      {expandedSections.has("payload") ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </div>
                    {expandedSections.has("payload") && (
                      <SyntaxHighlighter
                        language="json"
                        style={vscDarkPlus}
                        customStyle={{
                          borderRadius: "0.5rem",
                          maxHeight: "400px",
                          fontSize: "0.875rem",
                        }}
                      >
                        {JSON.stringify(selectedDelivery.payload, null, 2)}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="response" className="space-y-4">
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">Status Code:</h4>
                      <Badge
                        variant={
                          selectedDelivery.response_status_code &&
                          selectedDelivery.response_status_code >= 200 &&
                          selectedDelivery.response_status_code < 300
                            ? "default"
                            : "destructive"
                        }
                      >
                        {selectedDelivery.response_status_code || "N/A"}
                      </Badge>
                    </div>

                    {selectedDelivery.error_message && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{selectedDelivery.error_message}</AlertDescription>
                      </Alert>
                    )}

                    {selectedDelivery.response_body && (
                      <div>
                        <h4 className="font-semibold mb-2">Response Body</h4>
                        <div className="bg-muted p-4 rounded-lg overflow-auto max-h-96">
                          <pre className="text-sm">{selectedDelivery.response_body}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="timeline" className="space-y-4">
                  <div className="space-y-6">
                    {getTimelineSteps(selectedDelivery).map((step, index) => {
                      const Icon = step.icon;
                      return (
                        <div key={index} className="flex gap-4">
                          <div className="flex flex-col items-center">
                            <div
                              className={`rounded-full p-2 ${
                                step.status === "complete"
                                  ? "bg-green-500"
                                  : step.status === "failed"
                                  ? "bg-red-500"
                                  : "bg-muted"
                              }`}
                            >
                              <Icon className="h-4 w-4 text-white" />
                            </div>
                            {index < getTimelineSteps(selectedDelivery).length - 1 && (
                              <div className="w-0.5 h-12 bg-border" />
                            )}
                          </div>
                          <div className="flex-1 pb-8">
                            <p className="font-medium">{step.label}</p>
                            <p className="text-sm text-muted-foreground">
                              {format(new Date(step.time), "MMM d, yyyy HH:mm:ss")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <Eye className="h-12 w-12 mb-4" />
                <p>Select a delivery to view details</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
