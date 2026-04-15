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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Clock, Mail, Building2, AlertTriangle, CheckCircle2, XCircle, Timer, UserCheck, UserX, Handshake, Phone, Linkedin, MessageSquare, User } from "lucide-react";
import { format, differenceInDays, differenceInHours, isPast } from "date-fns";

// ─── Types ──────────────────────────────────────────────────────────
interface Engagement {
  id: string;
  match_id: string;
  org_id: string;
  counterparty_email: string | null;
  counterparty_org_id: string | null;
  counterparty_type: "known" | "unknown";
  engagement_status: "pending" | "notification_sent" | "contacted" | "accepted" | "declined" | "expired";
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

interface OutreachLog {
  id: string;
  admin_user_id: string;
  admin_email: string;
  admin_name: string | null;
  contact_method: string;
  contact_detail: string;
  previous_status: string;
  new_status: string;
  notes: string | null;
  created_at: string;
}

// ─── Status config ──────────────────────────────────────────────────
const STATUS_CONFIG = {
  pending: { label: "Awaiting Outreach", variant: "outline" as const, icon: AlertTriangle },
  notification_sent: { label: "Notification Sent", variant: "outline" as const, icon: Mail },
  contacted: { label: "Contacted", variant: "secondary" as const, icon: Clock },
  accepted: { label: "Accepted", variant: "default" as const, icon: CheckCircle2 },
  declined: { label: "Declined", variant: "destructive" as const, icon: XCircle },
  expired: { label: "Expired", variant: "outline" as const, icon: AlertTriangle },
};

const CONTACT_METHOD_CONFIG: Record<string, { label: string; icon: typeof Mail; placeholder: string }> = {
  email: { label: "Email", icon: Mail, placeholder: "counterparty@example.com" },
  phone: { label: "Phone Call", icon: Phone, placeholder: "+27 82 123 4567" },
  linkedin: { label: "LinkedIn", icon: Linkedin, placeholder: "https://linkedin.com/in/username" },
  whatsapp: { label: "WhatsApp", icon: MessageSquare, placeholder: "+27 82 123 4567" },
  in_person: { label: "In Person", icon: User, placeholder: "Name and location of meeting" },
  other: { label: "Other", icon: Clock, placeholder: "Describe the contact method and details" },
};

// ─── Expiry helpers ─────────────────────────────────────────────────
function getExpiryInfo(expiresAt: string) {
  const expiry = new Date(expiresAt);
  const now = new Date();
  if (isPast(expiry)) return { expired: true, days: 0, hours: 0, urgent: false };
  const days = differenceInDays(expiry, now);
  const hours = differenceInHours(expiry, now) % 24;
  return { expired: false, days, hours, urgent: days <= 2 };
}

function ExpiryCountdown({ expiresAt }: { expiresAt: string }) {
  const { expired, days, hours, urgent } = getExpiryInfo(expiresAt);

  if (expired) {
    return (
      <Badge variant="destructive" className="text-[10px] gap-1">
        <AlertTriangle className="h-3 w-3" /> Expired
      </Badge>
    );
  }

  return (
    <span className={`text-xs font-medium flex items-center gap-1 ${urgent ? "text-destructive" : "text-muted-foreground"}`}>
      <Timer className="h-3 w-3" />
      {days > 0 ? `${days}d ${hours}h` : `${hours}h`} left
    </span>
  );
}

// ─── Summary cards ──────────────────────────────────────────────────
function SummaryCards({ data }: { data: Engagement[] }) {
  const pending = data.filter((e) => ["pending", "notification_sent", "contacted"].includes(e.engagement_status)).length;
  const known = data.filter((e) => e.counterparty_type === "known").length;
  const unknown = data.filter((e) => e.counterparty_type === "unknown").length;
  const urgentCount = data.filter((e) => {
    if (["accepted", "declined", "expired"].includes(e.engagement_status)) return false;
    return getExpiryInfo(e.expires_at).urgent;
  }).length;

  const cards = [
    { label: "Pending", value: pending, icon: Handshake, color: "text-primary" },
    { label: "Known", value: known, icon: UserCheck, color: "text-success" },
    { label: "Unknown", value: unknown, icon: UserX, color: "text-muted-foreground" },
    { label: "Expiring Soon", value: urgentCount, icon: AlertTriangle, color: urgentCount > 0 ? "text-destructive" : "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-3 flex items-center gap-3">
            <c.icon className={`h-5 w-5 ${c.color} shrink-0`} />
            <div>
              <p className="text-lg font-semibold leading-none">{c.value}</p>
              <p className="text-[11px] text-muted-foreground">{c.label}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ─── Contact details section inside dialog ──────────────────────────
function ContactDetailsSection({ engagement }: { engagement: Engagement }) {
  return (
    <Card className="bg-muted/30">
      <CardHeader className="p-3 pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" /> Counterparty Details
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground text-xs">Type</span>
          <Badge variant={engagement.counterparty_type === "known" ? "default" : "outline"} className="text-[10px]">
            {engagement.counterparty_type === "known" ? "Known Organisation" : "Unknown / Unregistered"}
          </Badge>
        </div>
        {engagement.counterparty_org && (
          <div className="flex justify-between">
            <span className="text-muted-foreground text-xs">Organisation</span>
            <span className="font-medium text-xs">{engagement.counterparty_org.name}</span>
          </div>
        )}
        {engagement.counterparty_email && (
          <div className="flex justify-between">
            <span className="text-muted-foreground text-xs">Email</span>
            <a href={`mailto:${engagement.counterparty_email}`} className="text-xs text-primary hover:underline">
              {engagement.counterparty_email}
            </a>
          </div>
        )}
        {engagement.contacted_at && (
          <div className="flex justify-between">
            <span className="text-muted-foreground text-xs">Contacted</span>
            <span className="text-xs">{format(new Date(engagement.contacted_at), "dd MMM yyyy HH:mm")}</span>
          </div>
        )}
        {engagement.responded_at && (
          <div className="flex justify-between">
            <span className="text-muted-foreground text-xs">Responded</span>
            <span className="text-xs">{format(new Date(engagement.responded_at), "dd MMM yyyy HH:mm")}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Outreach Log (immutable history) ───────────────────────────────
function OutreachLogSection({ engagementId }: { engagementId: string }) {
  const { data: logs, isLoading } = useQuery({
    queryKey: ["outreach-logs", engagementId],
    queryFn: async () => {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/poi-engagements/${engagementId}/outreach-log`,
        {
          headers: {
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        }
      );
      if (!response.ok) return [];
      const result = await response.json();
      return (result?.logs as OutreachLog[]) || [];
    },
  });

  if (isLoading) return <Skeleton className="h-16 w-full" />;
  if (!logs || logs.length === 0) {
    return (
      <Card className="bg-muted/20 border-dashed">
        <CardContent className="py-4 text-center">
          <p className="text-xs text-muted-foreground">No outreach recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" /> Outreach History (immutable)
      </p>
      <div className="space-y-2">
        {logs.map((log) => {
          const methodCfg = CONTACT_METHOD_CONFIG[log.contact_method] || CONTACT_METHOD_CONFIG.other;
          const MethodIcon = methodCfg.icon;
          return (
            <Card key={log.id} className="bg-muted/20">
              <CardContent className="p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <MethodIcon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">{methodCfg.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {format(new Date(log.created_at), "dd MMM yyyy HH:mm")}
                  </span>
                </div>
                <div className="text-xs space-y-0.5">
                  <div className="flex gap-1">
                    <span className="text-muted-foreground shrink-0">By:</span>
                    <span className="font-medium">{log.admin_name || log.admin_email}</span>
                  </div>
                  <div className="flex gap-1">
                    <span className="text-muted-foreground shrink-0">To:</span>
                    {log.contact_method === "linkedin" ? (
                      <a href={log.contact_detail} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                        {log.contact_detail}
                      </a>
                    ) : (
                      <span className="truncate">{log.contact_detail}</span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <span className="text-muted-foreground shrink-0">Transition:</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {STATUS_CONFIG[log.previous_status as keyof typeof STATUS_CONFIG]?.label || log.previous_status}
                    </Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {STATUS_CONFIG[log.new_status as keyof typeof STATUS_CONFIG]?.label || log.new_status}
                    </Badge>
                  </div>
                  {log.notes && (
                    <div className="flex gap-1">
                      <span className="text-muted-foreground shrink-0">Notes:</span>
                      <span className="italic">{log.notes}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Panel ─────────────────────────────────────────────────────
export function AdminPendingEngagementsPanel() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [selectedEngagement, setSelectedEngagement] = useState<Engagement | null>(null);
  const [actionForm, setActionForm] = useState<{
    status?: string;
    email?: string;
    notes?: string;
    contactMethod?: string;
    contactDetail?: string;
    contactDate?: string;
  }>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-engagements", statusFilter, typeFilter],
    queryFn: async () => {
      const { data: result, error } = await supabase.functions.invoke("poi-engagements", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: null,
      });
      if (error) throw error;
      return (result?.engagements as Engagement[]) || [];
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
      queryClient.invalidateQueries({ queryKey: ["outreach-logs"] });
      toast.success("Engagement updated successfully");
      setSelectedEngagement(null);
      setActionForm({});
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleUpdate = () => {
    if (!selectedEngagement) return;
    const updates: Record<string, unknown> = {};
    if (actionForm.status) {
      if (actionForm.status === "contacted") {
        if (!actionForm.contactMethod) {
          toast.error("Please select a contact method before marking as Contacted");
          return;
        }
        if (!actionForm.contactDetail) {
          toast.error("Please provide the contact details (email, phone number, or LinkedIn URL)");
          return;
        }
      }
      updates.engagement_status = actionForm.status;
    }
    if (actionForm.email) updates.counterparty_email = actionForm.email;
    if (actionForm.notes) updates.admin_notes = actionForm.notes;
    if (actionForm.contactMethod) updates.contact_method = actionForm.contactMethod;
    if (actionForm.contactDetail) updates.contact_detail = actionForm.contactDetail;
    if (actionForm.contactDate) updates.contact_date = new Date(actionForm.contactDate).toISOString();
    if (Object.keys(updates).length === 0) {
      toast.error("No changes to save");
      return;
    }
    updateMutation.mutate({ id: selectedEngagement.id, updates });
  };

  const filteredData =
    data?.filter((e) => {
      if (statusFilter !== "all" && e.engagement_status !== statusFilter) return false;
      if (typeFilter !== "all" && e.counterparty_type !== typeFilter) return false;
      return true;
    }) || [];

  const openDetail = (engagement: Engagement) => {
    setSelectedEngagement(engagement);
    setActionForm({ email: engagement.counterparty_email || "", notes: engagement.admin_notes || "" });
  };

  const selectedContactMethodCfg = actionForm.contactMethod
    ? CONTACT_METHOD_CONFIG[actionForm.contactMethod]
    : null;

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      {!isLoading && data && <SummaryCards data={data} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Awaiting Outreach</SelectItem>
            <SelectItem value="notification_sent">Notification Sent</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="Counterparty type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="known">Known</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground ml-auto">
          {filteredData.length} result{filteredData.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : filteredData.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Handshake className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No engagements match the current filters.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Trade</TableHead>
                <TableHead className="text-xs">Initiator</TableHead>
                <TableHead className="text-xs">Counterparty</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs">Expiry</TableHead>
                <TableHead className="text-xs">Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.map((eng) => {
                const cfg = STATUS_CONFIG[eng.engagement_status];
                const StatusIcon = cfg.icon;
                return (
                  <TableRow
                    key={eng.id}
                    className="cursor-pointer"
                    onClick={() => openDetail(eng)}
                  >
                    <TableCell className="text-xs font-medium py-2">
                      {eng.matches?.commodity || "Trade"}
                      {eng.matches?.quantity_amount ? ` · ${eng.matches.quantity_amount} ${eng.matches.quantity_unit || ""}` : ""}
                    </TableCell>
                    <TableCell className="text-xs py-2">{eng.initiator_org?.name || "—"}</TableCell>
                    <TableCell className="text-xs py-2">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={eng.counterparty_type === "known" ? "default" : "outline"} className="text-[9px] px-1.5 py-0">
                          {eng.counterparty_type}
                        </Badge>
                        {eng.counterparty_org?.name && (
                          <span className="truncate max-w-[100px]">{eng.counterparty_org.name}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={cfg.variant} className="text-[10px] gap-1">
                        <StatusIcon className="h-3 w-3" />
                        {cfg.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <ExpiryCountdown expiresAt={eng.expires_at} />
                    </TableCell>
                    <TableCell className="text-xs py-2">
                      {eng.counterparty_email ? (
                        <span className="flex items-center gap-1 text-primary">
                          <Mail className="h-3 w-3" />
                          <span className="truncate max-w-[120px]">{eng.counterparty_email}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Detail / Action dialog */}
      <Dialog
        open={!!selectedEngagement}
        onOpenChange={(open) => {
          if (!open) { setSelectedEngagement(null); setActionForm({}); }
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Handshake className="h-4 w-4 text-primary" />
              Manage Engagement
            </DialogTitle>
            <DialogDescription>
              Update counterparty contact details, log outreach, or record a response.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {selectedEngagement && (
            <div className="space-y-4 pb-2">
              {/* Trade summary */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Status</p>
                  <Badge variant={STATUS_CONFIG[selectedEngagement.engagement_status].variant} className="mt-0.5">
                    {STATUS_CONFIG[selectedEngagement.engagement_status].label}
                  </Badge>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Time Remaining</p>
                  <ExpiryCountdown expiresAt={selectedEngagement.expires_at} />
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Commodity</p>
                  <p className="font-medium text-xs">{selectedEngagement.matches?.commodity || "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Created</p>
                  <p className="text-xs">{format(new Date(selectedEngagement.created_at), "dd MMM yyyy")}</p>
                </div>
              </div>

              {/* Contact details card */}
              <ContactDetailsSection engagement={selectedEngagement} />

              {/* ── Immutable Outreach Log ── */}
              <Separator />
              <OutreachLogSection engagementId={selectedEngagement.id} />
              <Separator />

              {/* Counterparty email (auto-link key) */}
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

              {/* Proof of contact fields — required when marking as Contacted */}
              {(["pending", "notification_sent"].includes(selectedEngagement.engagement_status) || selectedEngagement.engagement_status === "contacted") && (
                <div className="space-y-3 rounded-md border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground">Proof of Contact</p>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Contact Method</label>
                    <Select
                      value={actionForm.contactMethod || ""}
                      onValueChange={(v) => setActionForm((prev) => ({ ...prev, contactMethod: v, contactDetail: "" }))}
                    >
                      <SelectTrigger className="mt-1 h-8 text-xs">
                        <SelectValue placeholder="Select method of contact" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="phone">Phone Call</SelectItem>
                        <SelectItem value="linkedin">LinkedIn</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                        <SelectItem value="in_person">In Person</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Dynamic contact detail field */}
                  {actionForm.contactMethod && selectedContactMethodCfg && (
                    <div>
                      <label className="text-[11px] text-muted-foreground">
                        {actionForm.contactMethod === "email" && "Email Address Contacted"}
                        {actionForm.contactMethod === "phone" && "Phone Number Called"}
                        {actionForm.contactMethod === "linkedin" && "LinkedIn Profile URL"}
                        {actionForm.contactMethod === "whatsapp" && "WhatsApp Number"}
                        {actionForm.contactMethod === "in_person" && "Meeting Details"}
                        {actionForm.contactMethod === "other" && "Contact Details"}
                      </label>
                      <Input
                        type={actionForm.contactMethod === "email" ? "email" : actionForm.contactMethod === "linkedin" ? "url" : "text"}
                        placeholder={selectedContactMethodCfg.placeholder}
                        value={actionForm.contactDetail || ""}
                        onChange={(e) => setActionForm((prev) => ({ ...prev, contactDetail: e.target.value }))}
                        className="mt-1 h-8 text-xs"
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-[11px] text-muted-foreground">Contact Date & Time</label>
                    <Input
                      type="datetime-local"
                      value={actionForm.contactDate || ""}
                      onChange={(e) => setActionForm((prev) => ({ ...prev, contactDate: e.target.value }))}
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Status transition */}
              {!["accepted", "declined", "expired"].includes(selectedEngagement.engagement_status) && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Update Status</label>
                  <Select
                    value={actionForm.status || ""}
                    onValueChange={(v) => setActionForm((prev) => ({ ...prev, status: v }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Select new status" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedEngagement.engagement_status === "pending" && (
                        <>
                          <SelectItem value="contacted">Mark as Contacted</SelectItem>
                          <SelectItem value="notification_sent">Notification Sent</SelectItem>
                          <SelectItem value="expired">Mark as Expired</SelectItem>
                        </>
                      )}
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
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedEngagement(null)}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
