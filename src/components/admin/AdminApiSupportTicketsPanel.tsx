/**
 * Public API V1 · Batch 11 — Internal Support Ticket Triage panel (HQ).
 *
 * Internal-only view for platform_admin / api_admin / auditor.
 * Backed by SECURITY DEFINER RPCs:
 *   • list_api_support_tickets_internal
 *   • update_api_support_ticket_internal
 *
 * Auditors are read-only. Internal note / status / owner / client-visible
 * response edits are restricted to platform_admin and api_admin and are
 * audit-logged per change inside the RPC.
 *
 * Hard exclusions: no payment, invoice, webhook, write API, evidence/
 * document, POI/WaD/compliance fields.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";

const STATUSES = [
  "open", "triaged", "in_progress", "waiting_on_client", "resolved", "closed",
] as const;
const SEVERITIES = ["low", "medium", "high", "urgent"] as const;
const ENVIRONMENTS = ["sandbox", "production", "unspecified"] as const;

interface InternalTicket {
  id: string;
  api_client_id: string;
  org_id: string;
  created_by: string;
  subject: string;
  environment: string;
  severity: string;
  category: string;
  description: string;
  contact_name: string;
  contact_email: string;
  request_id: string | null;
  endpoint: string | null;
  external_reference: string | null;
  approximate_time: string | null;
  status: string;
  internal_owner: string | null;
  internal_notes: string | null;
  client_visible_response: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function AdminApiSupportTicketsPanel() {
  const { roles } = useAuth();
  const roleStrings = (roles ?? []) as readonly string[];
  const canManage =
    roleStrings.includes("platform_admin") || roleStrings.includes("api_admin");
  const canRead = canManage || roleStrings.includes("auditor");

  const [rows, setRows] = useState<InternalTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("any");
  const [severityFilter, setSeverityFilter] = useState<string>("any");
  const [envFilter, setEnvFilter] = useState<string>("any");
  const [selected, setSelected] = useState<InternalTicket | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("list_api_support_tickets_internal", {
        p_status: statusFilter === "any" ? null : statusFilter,
        p_severity: severityFilter === "any" ? null : severityFilter,
        p_environment: envFilter === "any" ? null : envFilter,
        p_api_client_id: null,
        p_limit: 500,
      });
      if (error) throw error;
      setRows((data ?? []) as unknown as InternalTicket[]);
    } catch (e) {
      toast.error("Could not load support tickets", { description: (e as Error).message });
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canRead) load(); /* eslint-disable-next-line */ }, [statusFilter, severityFilter, envFilter, canRead]);

  if (!canRead) {
    return <div className="text-sm text-muted-foreground">Internal API support tickets are restricted to platform admins, API admins and auditors. Internal notes are never shown to client users.</div>;
  }

  const summary = useMemo(() => ({
    total: rows.length,
    open: rows.filter((r) => ["open", "triaged", "in_progress", "waiting_on_client"].includes(r.status)).length,
    urgent: rows.filter((r) => r.severity === "urgent").length,
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground">Status</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">any</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Severity</span>
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">any</SelectItem>
            {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Environment</span>
        <Select value={envFilter} onValueChange={setEnvFilter}>
          <SelectTrigger className="w-[160px] h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">any</SelectItem>
            {ENVIRONMENTS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} className="ml-auto">
          <RefreshCw className="h-3.5 w-3.5 mr-2" /> Refresh
        </Button>
      </div>

      <div className="text-xs text-muted-foreground">
        {loading ? "Loading…" : `${summary.total} ticket(s) · ${summary.open} open · ${summary.urgent} urgent`}
      </div>

      <div className="overflow-x-auto rounded-sm border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="p-2 text-left">Subject</th>
              <th className="p-2 text-left">Client</th>
              <th className="p-2 text-left">Env</th>
              <th className="p-2 text-left">Severity</th>
              <th className="p-2 text-left">Category</th>
              <th className="p-2 text-left">Status</th>
              <th className="p-2 text-left">Created</th>
              <th className="p-2 text-left">Owner</th>
              <th className="p-2 text-left">Endpoint</th>
              <th className="p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="p-2 max-w-[28ch] truncate">{r.subject}</td>
                <td className="p-2 font-mono text-[11px]">{r.api_client_id.slice(0, 8)}…</td>
                <td className="p-2 font-mono text-[11px]">{r.environment}</td>
                <td className="p-2 font-mono text-[11px]">{r.severity}</td>
                <td className="p-2 font-mono text-[11px]">{r.category}</td>
                <td className="p-2 font-mono text-[11px]">{r.status}</td>
                <td className="p-2 font-mono text-[11px]">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</td>
                <td className="p-2 font-mono text-[11px]">{r.internal_owner ? r.internal_owner.slice(0, 8) + "…" : "—"}</td>
                <td className="p-2 font-mono text-[11px]">{r.endpoint ?? "—"}</td>
                <td className="p-2">
                  <Button size="sm" variant="outline" onClick={() => setSelected(r)}>Open</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <TicketDetail
          ticket={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onUpdated={async () => { await load(); setSelected(null); }}
        />
      ) : null}
    </div>
  );
}

function TicketDetail({
  ticket, canManage, onClose, onUpdated,
}: {
  ticket: InternalTicket; canManage: boolean; onClose: () => void; onUpdated: () => void;
}) {
  const [status, setStatus] = useState(ticket.status);
  const [internalOwner, setInternalOwner] = useState<string>(ticket.internal_owner ?? "");
  const [noteAppend, setNoteAppend] = useState("");
  const [clientResponse, setClientResponse] = useState(ticket.client_visible_response ?? "");
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      const { error } = await supabase.rpc("update_api_support_ticket_internal", {
        p_id: ticket.id,
        p_status: status !== ticket.status ? status : null,
        p_internal_owner: internalOwner && internalOwner !== ticket.internal_owner ? internalOwner : null,
        p_internal_note_append: noteAppend.trim() || null,
        p_client_visible_response:
          clientResponse !== (ticket.client_visible_response ?? "") ? clientResponse : null,
      });
      if (error) throw error;
      toast.success("Ticket updated");
      onUpdated();
    } catch (e) {
      toast.error("Could not update ticket", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog">
      <div className="bg-card border border-border rounded-sm max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-medium">{ticket.subject}</h3>
            <p className="text-[11px] font-mono text-muted-foreground">{ticket.id}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">Close</Button>
        </header>

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div><span className="text-muted-foreground">Severity</span><div className="font-mono">{ticket.severity}</div></div>
          <div><span className="text-muted-foreground">Category</span><div className="font-mono">{ticket.category}</div></div>
          <div><span className="text-muted-foreground">Environment</span><div className="font-mono">{ticket.environment}</div></div>
          <div><span className="text-muted-foreground">Contact</span><div>{ticket.contact_name} &lt;{ticket.contact_email}&gt;</div></div>
          <div><span className="text-muted-foreground">request_id</span><div className="font-mono">{ticket.request_id ?? "—"}</div></div>
          <div><span className="text-muted-foreground">endpoint</span><div className="font-mono">{ticket.endpoint ?? "—"}</div></div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Description (from client)</Label>
          <div className="whitespace-pre-wrap rounded-sm border border-border bg-muted/30 p-3 text-sm">{ticket.description}</div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Internal notes (NEVER shown to client)</Label>
          <div className="whitespace-pre-wrap rounded-sm border border-border bg-amber-50 text-amber-950 p-3 text-xs">
            {ticket.internal_notes ?? <span className="opacity-60">(none)</span>}
          </div>
        </div>

        {canManage ? (
          <div className="space-y-4 border-t border-border pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Internal owner (user_id, optional)</Label>
                <Input value={internalOwner} onChange={(e) => setInternalOwner(e.target.value)} placeholder="uuid" className="h-8 text-xs font-mono" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Append internal note (NEVER shown to client)</Label>
              <Textarea value={noteAppend} onChange={(e) => setNoteAppend(e.target.value)} rows={3} />
            </div>
            <div>
              <Label className="text-xs">Client-visible response</Label>
              <Textarea value={clientResponse} onChange={(e) => setClientResponse(e.target.value)} rows={3} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
            </div>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground border-t border-border pt-3">
            Read-only — auditor role cannot modify support tickets.
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminApiSupportTicketsPanel;
