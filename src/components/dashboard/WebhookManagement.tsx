import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Webhook, Plus, Trash2, Eye, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  status: string;
  created_at: string;
  last_delivery_at: string | null;
}

const AVAILABLE_EVENTS = [
  { id: "signal.created", label: "Signal Created", description: "Triggered when a new signal is created" },
  { id: "match.created", label: "Match Created", description: "Triggered when a match is made" },
  { id: "match.settled", label: "Intent Confirmed", description: "Triggered when intent is confirmed (no legal obligation)" },
  { id: "match.updated", label: "Match Updated", description: "Triggered when match data changes" },
];

export function WebhookManagement() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSecret, setShowSecret] = useState<{ [key: string]: boolean }>({});
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; webhookId: string | null }>({
    open: false,
    webhookId: null,
  });

  // Form state
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchWebhooks();
  }, []);

  const fetchWebhooks = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("webhook_endpoints")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setWebhooks(data || []);
    } catch (error) {
      console.error("Error fetching webhooks:", error);
      toast.error("Failed to load webhooks");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateWebhook = async () => {
    if (!url || selectedEvents.size === 0) {
      toast.error("Please provide a URL and select at least one event");
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", session.user.id)
        .single();

      if (!profile) return;

      // Generate a webhook secret
      const secret = `whsec_${crypto.randomUUID().replace(/-/g, '')}`;
      const encoder = new TextEncoder();
      const data = encoder.encode(secret);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const secretHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const { error } = await supabase
        .from("webhook_endpoints")
        .insert({
          org_id: profile.org_id,
          url,
          events: Array.from(selectedEvents),
          secret_hash: secretHash,
          status: "active",
        });

      if (error) throw error;

      toast.success("Webhook endpoint created successfully");
      toast.info(`Secret: ${secret}`, { duration: 10000 });
      
      setCreateDialogOpen(false);
      setUrl("");
      setSelectedEvents(new Set());
      fetchWebhooks();
    } catch (error) {
      console.error("Error creating webhook:", error);
      toast.error("Failed to create webhook endpoint");
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    try {
      const { error } = await supabase
        .from("webhook_endpoints")
        .delete()
        .eq("id", webhookId);

      if (error) throw error;

      toast.success("Webhook endpoint deleted");
      fetchWebhooks();
    } catch (error) {
      console.error("Error deleting webhook:", error);
      toast.error("Failed to delete webhook endpoint");
    } finally {
      setDeleteDialog({ open: false, webhookId: null });
    }
  };

  const toggleEventSelection = (eventId: string) => {
    const newSelected = new Set(selectedEvents);
    if (newSelected.has(eventId)) {
      newSelected.delete(eventId);
    } else {
      newSelected.add(eventId);
    }
    setSelectedEvents(newSelected);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Webhook className="h-8 w-8" />
            Webhooks
          </h2>
          <p className="text-muted-foreground mt-2">
            Receive real-time notifications for events in your account
          </p>
        </div>
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Endpoint
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Webhook Endpoint</DialogTitle>
              <DialogDescription>
                Add a new endpoint to receive event notifications. Make sure your endpoint can handle POST requests.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="url">Endpoint URL</Label>
                <Input
                  id="url"
                  placeholder="https://your-app.com/webhooks/compliance-matching"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="mt-2"
                />
              </div>
              <div>
                <Label>Events to Subscribe</Label>
                <div className="mt-3 space-y-3">
                  {AVAILABLE_EVENTS.map((event) => (
                    <div key={event.id} className="flex items-start space-x-3 p-3 border rounded-lg">
                      <Checkbox
                        id={event.id}
                        checked={selectedEvents.has(event.id)}
                        onCheckedChange={() => toggleEventSelection(event.id)}
                      />
                      <div className="flex-1">
                        <label
                          htmlFor={event.id}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          {event.label}
                        </label>
                        <p className="text-sm text-muted-foreground mt-1">{event.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateWebhook}>Create Endpoint</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your Endpoints</CardTitle>
              <CardDescription>Manage webhook endpoints for your organization</CardDescription>
            </div>
            <Button onClick={fetchWebhooks} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">Loading webhooks...</div>
          ) : webhooks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No webhook endpoints configured. Create one to get started.
            </div>
          ) : (
            <div className="border rounded-lg">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>URL</TableHead>
                    <TableHead>Events</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Delivery</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {webhooks.map((webhook) => (
                    <TableRow key={webhook.id}>
                      <TableCell className="font-mono text-xs max-w-[300px] truncate">
                        {webhook.url}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {webhook.events.map((event) => (
                            <Badge key={event} variant="outline" className="text-xs">
                              {event}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={webhook.status === "active" ? "default" : "secondary"}
                          className={webhook.status === "active" ? "bg-green-500 hover:bg-green-600" : ""}
                        >
                          {webhook.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {webhook.last_delivery_at
                          ? format(new Date(webhook.last_delivery_at), "MMM dd, HH:mm")
                          : "Never"}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteDialog({ open: true, webhookId: webhook.id })}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Webhook Security</CardTitle>
          <CardDescription>How webhook signatures work</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Each webhook request includes a <code className="bg-muted px-1 py-0.5 rounded">X-Webhook-Signature</code> header
            that you should verify to ensure the request came from our platform.
          </p>
          <div className="bg-muted p-4 rounded-lg font-mono text-xs">
            <div>X-Webhook-Signature: sha256=abc123...</div>
            <div className="mt-2">X-Webhook-Timestamp: 1234567890</div>
          </div>
          <p className="text-sm text-muted-foreground">
            Verify the signature by computing HMAC-SHA256 of the payload using your webhook secret.
          </p>
        </CardContent>
      </Card>

      <AlertDialog
        open={deleteDialog.open}
        onOpenChange={(open) => setDeleteDialog({ open, webhookId: null })}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Webhook Endpoint</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this webhook endpoint? This action cannot be undone and you will
              stop receiving events at this URL.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDialog.webhookId && handleDeleteWebhook(deleteDialog.webhookId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
