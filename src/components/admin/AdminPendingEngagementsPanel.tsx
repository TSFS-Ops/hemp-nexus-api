import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Clock, Mail, Building2, AlertTriangle, CheckCircle2, XCircle, Timer } from "lucide-react";
import { format, formatDistanceToNow, isPast } from "date-fns";

interface Engagement {
  id: string;
  match_id: string;
  org_id: string;
  counterparty_email: string | null;
  counterparty_org_id: string | null;
  counterparty_type: "known" | "unknown";
  engagement_status: "notification_sent" | "contacted" | "accepted" | "declined" | "expired";
  expires_at: string;
  contacted_at: string | null;
  responded_at: string | null;
  admin_notes: string | null;
  created_at: string;
  matches: {
    id: string;
    commodity: string | null;
    quantity_amount: number | null;
    quantity_unit: string | null;
    price_amount: number | null;
    price_currency: string | null;
    match_type: string | null;
    buyer_name: string | null;
    seller_name: string | null;
  } | null;
  initiator_org: { id: string; name: string } | null;
  counterparty_org: { id: string; name: string } | null;
}

const STATUS_CONFIG = {
  notification_sent: { label: "Notification Sent", variant: "outline" as const, icon: Mail },
  contacted: { label: "Contacted", variant: "secondary" as const, icon: Clock },
  accepted: { label: "Accepted", variant: "default" as const, icon: CheckCircle2 },
  declined: { label: "Declined", variant: "destructive" as const, icon: XCircle },
  expired: { label: "Expired", variant: "outline" as const, icon: AlertTriangle },
};

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const expiry = new Date(expiresAt);
  const expired = isPast(expiry);

  if (expired) {
    return <span className="text-destructive text-xs font-medium">Expired</span>;
  }

  return (
    <span className="text-xs text-muted-foreground flex items-center gap-1">
      <Timer className="h-3 w-3" />
      {formatDistanceToNow(expiry, { addSuffix: false })} left
    </span>
  );
}

export function AdminPendingEngagementsPanel() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedEngagement, setSelectedEngagement] = useState<Engagement | null>(null);
  const [actionForm, setActionForm] = useState<{
    status?: string;
    email?: string;
    notes?: string;
  }>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-engagements", statusFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      params.set("limit", "100");

      const { data: result, error } = await supabase.functions.invoke("poi-engagements", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: null,
      });

      if (error) throw error;
      return result?.engagements as Engagement[] || [];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/poi-engagements/${id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || err.message || "Update failed");
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-engagements"] });
      toast.success("Engagement updated successfully");
      setSelectedEngagement(null);
      setActionForm({});
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleUpdate = () => {
    if (!selectedEngagement) return;
    const updates: Record<string, unknown> = {};
    if (actionForm.status) updates.engagement_status = actionForm.status;
    if (actionForm.email) updates.counterparty_email = actionForm.email;
    if (actionForm.notes) updates.admin_notes = actionForm.notes;

    if (Object.keys(updates).length === 0) {
      toast.error("No changes to save");
      return;
    }

    updateMutation.mutate({ id: selectedEngagement.id, updates });
  };

  const filteredData = data?.filter((e) => {
    if (statusFilter !== "all" && e.engagement_status !== statusFilter) return false;
    if (typeFilter !== "all" && e.counterparty_type !== typeFilter) return false;
    return true;
  }) || [];

  const pendingCount = data?.filter(
    (e) => !["accepted", "declined", "expired"].includes(e.engagement_status)
  ).length || 0;

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Clock className="h-4 w-4 text-primary" />
          <span>{pendingCount} pending</span>
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="notification_sent">Notification Sent</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="known">Known</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Engagement cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : filteredData.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No engagements match the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredData.map((engagement) => {
            const cfg = STATUS_CONFIG[engagement.engagement_status];
            const StatusIcon = cfg.icon;
            return (
              <Card
                key={engagement.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => {
                  setSelectedEngagement(engagement);
                  setActionForm({
                    email: engagement.counterparty_email || "",
                    notes: engagement.admin_notes || "",
                  });
                }}
              >
                <CardContent className="p-3 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium truncate">
                          {engagement.matches?.commodity || "Trade"} —{" "}
                          {engagement.matches?.quantity_amount}{" "}
                          {engagement.matches?.quantity_unit}
                        </span>
                        <Badge variant={cfg.variant} className="text-[10px] gap-1">
                          <StatusIcon className="h-3 w-3" />
                          {cfg.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {engagement.counterparty_type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Building2 className="h-3 w-3" />
                          {engagement.initiator_org?.name || "Unknown"}
                        </span>
                        {engagement.counterparty_email && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {engagement.counterparty_email}
                          </span>
                        )}
                        <span>{format(new Date(engagement.created_at), "dd MMM yyyy")}</span>
                      </div>
                    </div>
                    <ExpiryCountdown expiresAt={engagement.expires_at} />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail / Action dialog */}
      <Dialog
        open={!!selectedEngagement}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEngagement(null);
            setActionForm({});
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage Engagement</DialogTitle>
            <DialogDescription>
              Update counterparty contact details, log outreach, or record a response.
            </DialogDescription>
          </DialogHeader>

          {selectedEngagement && (
            <div className="space-y-4">
              {/* Current state */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <Badge variant={STATUS_CONFIG[selectedEngagement.engagement_status].variant}>
                    {STATUS_CONFIG[selectedEngagement.engagement_status].label}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Type</p>
                  <p className="font-medium capitalize">{selectedEngagement.counterparty_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Initiator</p>
                  <p className="font-medium">{selectedEngagement.initiator_org?.name || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Expires</p>
                  <ExpiryCountdown expiresAt={selectedEngagement.expires_at} />
                </div>
              </div>

              {/* Counterparty email (lookup key) */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  Counterparty Email (auto-link key)
                </label>
                <Input
                  type="email"
                  placeholder="counterparty@example.com"
                  value={actionForm.email || ""}
                  onChange={(e) => setActionForm((prev) => ({ ...prev, email: e.target.value }))}
                  className="mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  If this person registers with this email, they'll be auto-linked to the trade.
                </p>
              </div>

              {/* Status transition */}
              {!["accepted", "declined", "expired"].includes(selectedEngagement.engagement_status) && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    Update Status
                  </label>
                  <Select
                    value={actionForm.status || ""}
                    onValueChange={(v) => setActionForm((prev) => ({ ...prev, status: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select new status" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedEngagement.engagement_status === "notification_sent" && (
                        <>
                          <SelectItem value="contacted">Mark as Contacted</SelectItem>
                          <SelectItem value="expired">Mark as Expired</SelectItem>
                        </>
                      )}
                      {selectedEngagement.engagement_status === "contacted" && (
                        <>
                          <SelectItem value="accepted">Counterparty Accepted</SelectItem>
                          <SelectItem value="declined">Counterparty Declined</SelectItem>
                          <SelectItem value="expired">Mark as Expired</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Admin notes */}
              <div>
                <label className="text-xs font-medium text-muted-foreground">Admin Notes</label>
                <Textarea
                  placeholder="Log outreach details, responses, etc."
                  value={actionForm.notes || ""}
                  onChange={(e) => setActionForm((prev) => ({ ...prev, notes: e.target.value }))}
                  className="mt-1"
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedEngagement(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
